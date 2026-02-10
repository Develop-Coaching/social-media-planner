import { NextRequest, NextResponse } from "next/server";
import { getImages, signImageParams } from "@/lib/images";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("uid");
  const cid = searchParams.get("cid");
  const key = searchParams.get("key");
  const exp = searchParams.get("exp");
  const sig = searchParams.get("sig");

  if (!uid || !cid || !key || !exp || !sig) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const expiresAt = parseInt(exp, 10);
  if (isNaN(expiresAt) || Date.now() / 1000 > expiresAt) {
    return NextResponse.json({ error: "Link expired" }, { status: 403 });
  }

  const expectedSig = signImageParams(uid, cid, key, expiresAt);
  if (sig !== expectedSig) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const images = await getImages(uid, cid);
  const dataUrl = images[key];
  if (!dataUrl) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return NextResponse.json(
      { error: "Invalid image data" },
      { status: 500 }
    );
  }

  const [, contentType, base64Data] = match;
  const buffer = Buffer.from(base64Data, "base64");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
