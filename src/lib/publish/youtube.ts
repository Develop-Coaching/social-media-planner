import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { google } from "googleapis";
import type { PublishPayload, PublishResult } from "./types";
import type { PrepareOutcome, ProviderCheckpoint } from "../publisher/runtime-types";

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TAGS_LENGTH = 500;

export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
}

function truncate(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

export function youtubeSourceTag(idempotencyKey: string): string {
  return `dcsrc_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;
}

export function buildYouTubeMetadata(caption: string, sourceTag?: string): YouTubeMetadata {
  const description = truncate(caption.trim(), MAX_DESCRIPTION_LENGTH);
  const firstLine = description.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  const title = truncate(firstLine || "Develop Coaching", MAX_TITLE_LENGTH);
  const candidates = [
    ...(sourceTag ? [sourceTag] : []),
    ...Array.from(description.matchAll(/#([\p{L}\p{N}_-]+)/gu), (match) => match[1]),
  ];
  const tags: string[] = [];
  let totalLength = 0;
  for (const candidate of candidates) {
    const tag = truncate(candidate, 100);
    if (!tag || tags.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) continue;
    const nextLength = totalLength + tag.length + (tags.length ? 1 : 0);
    if (nextLength > MAX_TAGS_LENGTH) break;
    tags.push(tag);
    totalLength = nextLength;
  }
  return { title, description, tags };
}

export function youtubeConfigured(): boolean {
  return Boolean(
    process.env.YOUTUBE_CLIENT_ID
      && process.env.YOUTUBE_CLIENT_SECRET
      && process.env.YOUTUBE_REFRESH_TOKEN,
  );
}

export async function prepareYouTubeForPublisher(
  payload: PublishPayload,
  existing: ProviderCheckpoint,
  sourceTag?: string,
): Promise<PrepareOutcome> {
  if (!payload.isReel || !payload.videoUrl) {
    return { kind: "permanent_failure", error: "YouTube deliveries require reel or video media" };
  }
  if (Object.keys(existing).length > 0 && (
    existing.youtube_media_kind !== "short"
      || (existing.youtube_source_tag !== undefined && existing.youtube_source_tag !== sourceTag)
  )) {
    return { kind: "permanent_failure", error: "YouTube reconciliation checkpoint is invalid" };
  }
  // Deliberately local-only: preparation validates and derives metadata but
  // never contacts YouTube. The first public provider call is videos.insert,
  // after the worker has durably marked dispatch_started.
  buildYouTubeMetadata(payload.caption, sourceTag);
  return { kind: "ready", checkpoint: { youtube_media_kind: "short", ...(sourceTag ? { youtube_source_tag: sourceTag } : {}) } };
}

type YouTubeInsert = (input: {
  part: string[];
  requestBody: {
    snippet: { title: string; description: string; tags: string[]; categoryId: string };
    status: { privacyStatus: "public" | "unlisted" | "private"; selfDeclaredMadeForKids: false };
  };
  media: { body: Readable };
}) => Promise<{ data: { id?: string | null } }>;

export async function dispatchPreparedYouTube(
  payload: PublishPayload,
  checkpoint: ProviderCheckpoint,
  options: { fetcher?: typeof fetch; insert?: YouTubeInsert } = {},
): Promise<PublishResult> {
  if (!youtubeConfigured()) return { success: false, platform: "youtube", error: "YouTube credentials are not configured" };
  if (!payload.videoUrl || !payload.isReel || checkpoint.youtube_media_kind !== "short") {
    return { success: false, platform: "youtube", error: "YouTube dispatch requires prepared video media" };
  }

  try {
    const source = await (options.fetcher ?? fetch)(payload.videoUrl, { cache: "no-store" });
    if (!source.ok) throw new Error(`video source returned ${source.status}`);
    const bytes = Buffer.from(await source.arrayBuffer());
    if (bytes.length === 0) throw new Error("video source was empty");

    const sourceTag = typeof checkpoint.youtube_source_tag === "string" ? checkpoint.youtube_source_tag : undefined;
    const metadata = buildYouTubeMetadata(payload.caption, sourceTag);
    const privacy = process.env.YOUTUBE_PRIVACY_STATUS;
    const privacyStatus = privacy === "private" || privacy === "unlisted" || privacy === "public" ? privacy : "public";
    let insert = options.insert;
    if (!insert) {
      const auth = new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET);
      auth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
      const youtube = google.youtube({ version: "v3", auth });
      insert = youtube.videos.insert.bind(youtube.videos) as YouTubeInsert;
    }
    const response = await insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: { ...metadata, categoryId: process.env.YOUTUBE_CATEGORY_ID || "22" },
        status: { privacyStatus, selfDeclaredMadeForKids: false },
      },
      media: { body: Readable.from(bytes) },
    });
    const id = response.data.id?.trim();
    if (!id) throw new Error("videos.insert returned no durable video ID");
    return {
      success: true,
      platform: "youtube",
      externalId: id,
      externalUrl: `https://www.youtube.com/shorts/${encodeURIComponent(id)}`,
    };
  } catch (error) {
    return {
      success: false,
      platform: "youtube",
      error: `YouTube upload outcome requires verification: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
