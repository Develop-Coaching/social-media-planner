import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createHash } from "node:crypto";
import { google } from "googleapis";
import type { PublishPayload, PublishResult } from "./types";
import type { ProviderCheckpoint } from "../publisher/runtime-types";

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TAGS_LENGTH = 500;
export const DEFAULT_YOUTUBE_MAX_VIDEO_BYTES = 50 * 1024 * 1024;

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

export type YouTubePrepareOutcome =
  | { kind: "ready"; checkpoint: ProviderCheckpoint; mediaBody: Readable }
  | { kind: "safe_retry" | "permanent_failure" | "indeterminate"; error: string; checkpoint?: ProviderCheckpoint };

function configuredMaxVideoBytes(): number {
  if (!process.env.YOUTUBE_MAX_VIDEO_BYTES) return DEFAULT_YOUTUBE_MAX_VIDEO_BYTES;
  const value = Number(process.env.YOUTUBE_MAX_VIDEO_BYTES);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100 * 1024 * 1024) {
    throw new Error("YOUTUBE_MAX_VIDEO_BYTES must be an integer between 1 and 104857600");
  }
  return value;
}

function boundedSourceStream(body: NodeReadableStream, expectedBytes: number, maxBytes: number): Readable {
  let seen = 0;
  const bound = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) callback(new Error(`YouTube video stream exceeded ${maxBytes} bytes`));
      else callback(null, chunk);
    },
    flush(callback) {
      if (seen !== expectedBytes) callback(new Error(`YouTube video stream length ${seen} did not match Content-Length ${expectedBytes}`));
      else callback();
    },
  });
  const source = Readable.fromWeb(body);
  source.once("error", (error) => bound.destroy(error));
  return source.pipe(bound);
}

export async function prepareYouTubeForPublisher(
  payload: PublishPayload,
  existing: ProviderCheckpoint,
  sourceTag?: string,
  options: { fetcher?: typeof fetch; maxVideoBytes?: number } = {},
): Promise<YouTubePrepareOutcome> {
  if (!payload.isReel || !payload.videoUrl) {
    return { kind: "permanent_failure", error: "YouTube deliveries require reel or video media" };
  }
  if (Object.keys(existing).length > 0 && (
    existing.youtube_media_kind !== "short"
      || (existing.youtube_source_tag !== undefined && existing.youtube_source_tag !== sourceTag)
  )) {
    return { kind: "permanent_failure", error: "YouTube reconciliation checkpoint is invalid" };
  }
  try {
    const maxVideoBytes = options.maxVideoBytes ?? configuredMaxVideoBytes();
    const source = await (options.fetcher ?? fetch)(payload.videoUrl, { method: "GET", cache: "no-store" });
    if (!source.ok) {
      await source.body?.cancel();
      return { kind: "safe_retry", error: `YouTube video source returned ${source.status}` };
    }
    const contentLength = source.headers.get("content-length");
    if (!contentLength || !/^\d+$/.test(contentLength)) {
      await source.body?.cancel();
      return { kind: "safe_retry", error: "YouTube video source did not provide a valid Content-Length" };
    }
    const size = Number(contentLength);
    if (size < 1 || size > maxVideoBytes) {
      await source.body?.cancel();
      return { kind: "permanent_failure", error: `YouTube video source size ${size} is outside the allowed 1-${maxVideoBytes} byte range` };
    }
    if (!source.body) return { kind: "safe_retry", error: "YouTube video source returned no stream" };

    // This fetch is only against the tenant-scoped signed media URL. No
    // YouTube request occurs until the worker durably marks dispatch_started.
    buildYouTubeMetadata(payload.caption, sourceTag);
    return {
      kind: "ready",
      checkpoint: { youtube_media_kind: "short", ...(sourceTag ? { youtube_source_tag: sourceTag } : {}) },
      mediaBody: boundedSourceStream(source.body as unknown as NodeReadableStream, size, maxVideoBytes),
    };
  } catch (error) {
    return { kind: "safe_retry", error: `YouTube video source preflight failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

type YouTubeInsert = (input: {
  part: string[];
  requestBody: {
    snippet: { title: string; description: string; tags: string[]; categoryId: string };
    status: { privacyStatus: "public" | "unlisted" | "private"; selfDeclaredMadeForKids: false };
  };
  media: { body: Readable };
}, options: { retry: false }) => Promise<{ data: { id?: string | null } }>;

export async function dispatchPreparedYouTube(
  payload: PublishPayload,
  checkpoint: ProviderCheckpoint,
  options: { mediaBody?: Readable; insert?: YouTubeInsert } = {},
): Promise<PublishResult> {
  if (!youtubeConfigured()) return { success: false, platform: "youtube", error: "YouTube credentials are not configured" };
  if (!payload.videoUrl || !payload.isReel || checkpoint.youtube_media_kind !== "short" || !options.mediaBody) {
    return { success: false, platform: "youtube", error: "YouTube dispatch requires prepared video media" };
  }

  try {
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
      media: { body: options.mediaBody },
    }, { retry: false });
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
