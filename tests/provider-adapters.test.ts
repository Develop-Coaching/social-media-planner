import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareInstagramForPublisher, publishToFacebook } from "@/lib/publish/meta";
import { prepareLinkedInForPublisher, publishToLinkedIn } from "@/lib/publish/linkedin";

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
