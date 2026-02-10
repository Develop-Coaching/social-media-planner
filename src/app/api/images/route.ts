import { NextRequest, NextResponse } from "next/server";
import { getImages, saveImage, saveAllImages, deleteImage } from "@/lib/images";
import { requireAuth, AuthError } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const images = await getImages(userId, companyId);
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
    const { companyId, key, dataUrl } = body as {
      companyId?: string;
      key?: string;
      dataUrl?: string;
    };

    if (!companyId || !key || !dataUrl) {
      return NextResponse.json({ error: "companyId, key, and dataUrl are required" }, { status: 400 });
    }

    await saveImage(userId, companyId, key, dataUrl);
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
    const { companyId, images } = body as {
      companyId?: string;
      images?: Record<string, string>;
    };

    if (!companyId || !images) {
      return NextResponse.json({ error: "companyId and images are required" }, { status: 400 });
    }

    await saveAllImages(userId, companyId, images);
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
    const key = searchParams.get("key");

    if (!companyId || !key) {
      return NextResponse.json({ error: "companyId and key are required" }, { status: 400 });
    }

    await deleteImage(userId, companyId, key);
    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to delete image" }, { status: 500 });
  }
}
