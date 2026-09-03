import { afterEach, describe, expect, it, vi } from "vitest";
import { publishToFacebook } from "@/lib/publish/meta";
import { publishToLinkedIn } from "@/lib/publish/linkedin";

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
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:99" } }));

    const result = await publishToLinkedIn({ caption: "video", imageUrls: [], videoUrl: "https://media.invalid/video.mp4", coverUrl: null, isReel: true });
    expect(result).toMatchObject({ success: true, externalId: "urn:li:share:99", externalUrl: "https://www.linkedin.com/feed/update/urn:li:share:99/" });
    const finalize = JSON.parse(String(fetcher.mock.calls[4][1]?.body));
    expect(finalize.finalizeUploadRequest.uploadedPartIds).toEqual(["etag-one", "etag-two"]);
    const post = JSON.parse(String(fetcher.mock.calls[5][1]?.body));
    expect(post.content.media.id).toBe("urn:li:video:video-1");
    expect(fetcher.mock.calls[5][1]?.headers).toMatchObject({ "X-Restli-Protocol-Version": "2.0.0", "LinkedIn-Version": "202606" });
  });

  it("does not call a 201 LinkedIn response successful without x-restli-id", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "secret";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:member-1";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 201 }));
    const result = await publishToLinkedIn({ caption: "text", imageUrls: [], videoUrl: null, coverUrl: null, isReel: false });
    expect(result).toMatchObject({ success: false, error: "LinkedIn returned 201 without x-restli-id" });
  });
});
