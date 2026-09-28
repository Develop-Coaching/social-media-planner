import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { prepareInstagramForPublisher, publishToFacebook } from "@/lib/publish/meta";
import { prepareLinkedInForPublisher, publishToLinkedIn } from "@/lib/publish/linkedin";
import { buildYouTubeMetadata, dispatchPreparedYouTube, prepareYouTubeForPublisher, youtubeSourceTag } from "@/lib/publish/youtube";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("provider response semantics", () => {
  it("stores Facebook's provider ID and read-only canonical permalink", async () => {
    process.env.META_PAGE_ACCESS_TOKEN = "secret";
    process.env.META_FB_PAGE_ID = "page-1";
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ post_id: "page-1_99" }))
      .mockResolvedValueOnce(Response.json({ permalink_url: "https://www.facebook.com/page/posts/99" }));
    const result = await publishToFacebook({ caption: "hello", imageUrls: ["https://media.invalid/image.jpg"], videoUrl: null, coverUrl: null, isReel: false });
    expect(result).toMatchObject({ success: true, externalId: "page-1_99", externalUrl: "https://www.facebook.com/page/posts/99" });
    expect(fetcher.mock.calls[0][1]?.method).toBe("POST");
    expect(fetcher.mock.calls[1][1]?.method ?? "GET").toBe("GET");
  });

  it("uploads every LinkedIn video byte range, finalizes with ordered ETags, and requires x-restli-id", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "secret";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:member-1";
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4])))
      .mockResolvedValueOnce(Response.json({ value: {
        video: "urn:li:video:video-1", uploadToken: "upload-token",
        uploadInstructions: [
          { uploadUrl: "https://upload.invalid/one", firstByte: 0, lastByte: 1 },
          { uploadUrl: "https://upload.invalid/two", firstByte: 2, lastByte: 3 },
        ],
      } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: "etag-one" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: "etag-two" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ status: "AVAILABLE" }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:99" } }));

    const result = await publishToLinkedIn({ caption: "video", imageUrls: [], videoUrl: "https://media.invalid/video.mp4", coverUrl: null, isReel: true });
    expect(result).toMatchObject({ success: true, externalId: "urn:li:share:99", externalUrl: "https://www.linkedin.com/feed/update/urn:li:share:99/" });
    const finalize = JSON.parse(String(fetcher.mock.calls[4][1]?.body));
    expect(finalize.finalizeUploadRequest.uploadedPartIds).toEqual(["etag-one", "etag-two"]);
    const post = JSON.parse(String(fetcher.mock.calls[6][1]?.body));
    expect(post.content.media.id).toBe("urn:li:video:video-1");
    expect(fetcher.mock.calls[6][1]?.headers).toMatchObject({ "X-Restli-Protocol-Version": "2.0.0", "LinkedIn-Version": "202606" });
  });

  it("does not call a 201 LinkedIn response successful without x-restli-id", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "secret";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:member-1";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 201 }));
    const result = await publishToLinkedIn({ caption: "text", imageUrls: [], videoUrl: null, coverUrl: null, isReel: false });
    expect(result).toMatchObject({ success: false, error: "LinkedIn returned 201 without x-restli-id" });
  });
});

describe("provider preparation is resumable before public dispatch", () => {
  const payload = { caption: "video", imageUrls: [], videoUrl: "https://media.invalid/video.mp4", coverUrl: null, isReel: true };

  it("persists a new Instagram container then resumes it without creating another", async () => {
    process.env.META_ACCESS_TOKEN = "secret";
    process.env.META_IG_USER_ID = "ig-1";
    const globalFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ id: "container-1" }));
    const created = await prepareInstagramForPublisher(payload, {});
    expect(created).toMatchObject({ kind: "safe_retry", checkpoint: { instagram_creation_id: "container-1", instagram_media_kind: "reel" } });
    const statusFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ status_code: "FINISHED" }));
    const resumed = await prepareInstagramForPublisher(payload, created.checkpoint!, { fetcher: statusFetch, maxPolls: 1 });
    expect(resumed.kind).toBe("ready");
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(statusFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["AVAILABLE", "ready"],
    ["PROCESSING_FAILED", "permanent_failure"],
    ["PROCESSING", "indeterminate"],
  ])("classifies LinkedIn video readiness %s as %s", async (status, expected) => {
    process.env.LINKEDIN_ACCESS_TOKEN = "secret";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:member-1";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status }));
    const result = await prepareLinkedInForPublisher(payload, { linkedin_video_urn: "urn:li:video:one" }, {
      fetcher, maxPolls: 1, sleep: async () => {},
    });
    expect(result.kind).toBe(expected);
  });

  it("classifies a LinkedIn readiness transport failure as indeterminate", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "secret";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:member-1";
    const result = await prepareLinkedInForPublisher(payload, { linkedin_video_urn: "urn:li:video:one" }, {
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error("network")), maxPolls: 1,
    });
    expect(result.kind).toBe("indeterminate");
  });

  it("returns a safe retry when LinkedIn upload fails before a Posts POST", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "secret";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:member-1";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("source unavailable"));
    const result = await prepareLinkedInForPublisher(payload, {});
    expect(result.kind).toBe("safe_retry");
  });
});

describe("YouTube Shorts adapter", () => {
  const payload = { caption: "A builder title\nUseful detail #Builders #Tips #builders", imageUrls: [], videoUrl: "https://media.invalid/reel.mp4", coverUrl: null, isReel: true };

  it("derives bounded metadata and a stable invisible source tag", () => {
    const sourceTag = youtubeSourceTag("native:stable-delivery");
    const metadata = buildYouTubeMetadata(`${"T".repeat(120)}\n${"D".repeat(5100)} #Builders`, sourceTag);
    expect(Array.from(metadata.title)).toHaveLength(100);
    expect(Array.from(metadata.description)).toHaveLength(5000);
    expect(metadata.tags[0]).toBe(sourceTag);
    expect(metadata.tags.join(",").length).toBeLessThanOrEqual(500);
    expect(metadata.description).not.toContain(sourceTag);
    expect(youtubeSourceTag("native:stable-delivery")).toBe(sourceTag);
  });

  it("prepares a bounded source stream without making a YouTube provider call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-length": "3" } }));
    const sourceTag = youtubeSourceTag("native:one:youtube");
    const result = await prepareYouTubeForPublisher(payload, {}, sourceTag, { fetcher });
    expect(result).toMatchObject({ kind: "ready", checkpoint: { youtube_media_kind: "short", youtube_source_tag: sourceTag } });
    expect(fetcher).toHaveBeenCalledWith(payload.videoUrl, { method: "GET", cache: "no-store" });
  });

  it("rejects non-video input before public dispatch", async () => {
    const result = await prepareYouTubeForPublisher({ ...payload, videoUrl: null, isReel: false }, {}, youtubeSourceTag("one"));
    expect(result.kind).toBe("permanent_failure");
  });

  it("safe-retries a missing or failed source before videos.insert can begin", async () => {
    const sourceTag = youtubeSourceTag("native:missing:youtube");
    const missing = await prepareYouTubeForPublisher(payload, {}, sourceTag, {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
    });
    const failed = await prepareYouTubeForPublisher(payload, {}, sourceTag, {
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error("storage unavailable")),
    });
    expect(missing).toMatchObject({ kind: "safe_retry", error: "YouTube video source returned 404" });
    expect(failed).toMatchObject({ kind: "safe_retry" });
    expect(failed.kind === "safe_retry" && failed.error).toContain("storage unavailable");
  });

  it("permanently rejects an oversized source before videos.insert can begin", async () => {
    const result = await prepareYouTubeForPublisher(payload, {}, youtubeSourceTag("oversize"), {
      maxVideoBytes: 10,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1]), { headers: { "content-length": "11" } })),
    });
    expect(result).toMatchObject({ kind: "permanent_failure" });
  });

  it("uploads once and returns the durable ID and Shorts URL", async () => {
    process.env.YOUTUBE_CLIENT_ID = "client";
    process.env.YOUTUBE_CLIENT_SECRET = "secret";
    process.env.YOUTUBE_REFRESH_TOKEN = "refresh";
    const insert = vi.fn().mockResolvedValue({ data: { id: "video-123" } });
    const mediaBody = Readable.from([new Uint8Array([1, 2, 3])]);
    const sourceTag = youtubeSourceTag("native:one:youtube");
    const result = await dispatchPreparedYouTube(payload, { youtube_media_kind: "short", youtube_source_tag: sourceTag }, { mediaBody, insert });
    expect(result).toMatchObject({ success: true, externalId: "video-123", externalUrl: "https://www.youtube.com/shorts/video-123" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0].requestBody.snippet.tags[0]).toBe(sourceTag);
    expect(insert.mock.calls[0][1]).toEqual({ retry: false });
  });

  it("returns an indeterminate-compatible failure when videos.insert has no durable result", async () => {
    process.env.YOUTUBE_CLIENT_ID = "client";
    process.env.YOUTUBE_CLIENT_SECRET = "secret";
    process.env.YOUTUBE_REFRESH_TOKEN = "refresh";
    const result = await dispatchPreparedYouTube(payload, { youtube_media_kind: "short", youtube_source_tag: youtubeSourceTag("one") }, {
      mediaBody: Readable.from([new Uint8Array([1])]),
      insert: vi.fn().mockRejectedValue(new Error("connection lost")),
    });
    expect(result).toMatchObject({ success: false, platform: "youtube" });
    expect(result.error).toContain("requires verification");
  });

  it("streams a lying source through a hard byte bound and treats failure after videos.insert as ambiguous", async () => {
    process.env.YOUTUBE_CLIENT_ID = "client";
    process.env.YOUTUBE_CLIENT_SECRET = "secret";
    process.env.YOUTUBE_REFRESH_TOKEN = "refresh";
    const prepared = await prepareYouTubeForPublisher(payload, {}, youtubeSourceTag("lying-source"), {
      maxVideoBytes: 2,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-length": "2" } })),
    });
    expect(prepared.kind).toBe("ready");
    if (prepared.kind !== "ready") throw new Error("expected prepared stream");
    const insert = vi.fn(async (input: { media: { body: Readable } }) => {
      for await (const _chunk of input.media.body) { /* consume like googleapis */ }
      return { data: { id: "should-not-complete" } };
    });
    const result = await dispatchPreparedYouTube(payload, prepared.checkpoint, { mediaBody: prepared.mediaBody, insert });
    expect(result).toMatchObject({ success: false, platform: "youtube" });
    expect(result.error).toContain("requires verification");
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
