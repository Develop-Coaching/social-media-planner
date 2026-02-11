import { NextRequest, NextResponse } from "next/server";
import { getImages, saveImage, saveAllImages, deleteImage } from "@/lib/images";
import { requireAuth, AuthError } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const savedContentId = searchParams.get("savedContentId");

    if (!companyId || !savedContentId) {
      return NextResponse.json({ error: "companyId and savedContentId are required" }, { status: 400 });
    }

    const images = await getImages(userId, companyId, savedContentId);
    return NextResponse.json({ images });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to load images" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { companyId, savedContentId, key, dataUrl } = body as {
      companyId?: string;
      savedContentId?: string;
      key?: string;
      dataUrl?: string;
    };

    if (!companyId || !savedContentId || !key || !dataUrl) {
      return NextResponse.json({ error: "companyId, savedContentId, key, and dataUrl are required" }, { status: 400 });
    }

    await saveImage(userId, companyId, savedContentId, key, dataUrl);
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to save image" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { companyId, savedContentId, images } = body as {
      companyId?: string;
      savedContentId?: string;
      images?: Record<string, string>;
    };

    if (!companyId || !savedContentId || !images) {
      return NextResponse.json({ error: "companyId, savedContentId, and images are required" }, { status: 400 });
    }

    await saveAllImages(userId, companyId, savedContentId, images);
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to save images" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const savedContentId = searchParams.get("savedContentId");
    const key = searchParams.get("key");

    if (!companyId || !savedContentId || !key) {
      return NextResponse.json({ error: "companyId, savedContentId, and key are required" }, { status: 400 });
    }

    await deleteImage(userId, companyId, savedContentId, key);
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to delete image" }, { status: 500 });
  }
}
