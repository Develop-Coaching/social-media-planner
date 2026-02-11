import { NextRequest, NextResponse } from "next/server";
import {
  getSavedContent,
  addSavedContent,
  deleteSavedContent,
  updateSavedContent,
  markCompleted,
  SavedContentItem,
} from "@/lib/saved-content";
import { saveAllImages } from "@/lib/images";
import { requireAuth, AuthError } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const items = await getSavedContent(userId, companyId);
    return NextResponse.json({ items });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to load saved content" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { companyId, name, theme, content, images } = body as {
      companyId?: string;
      name?: string;
      theme?: SavedContentItem["theme"];
      content?: SavedContentItem["content"];
      images?: Record<string, string>;
    };

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    if (!name || !theme || !content) {
      return NextResponse.json(
        { error: "name, theme, and content are required" },
        { status: 400 }
      );
    }

    const item = await addSavedContent(userId, companyId, name, theme, content);

    // If images were provided, bulk-save them scoped to the new saved content
    if (images && Object.keys(images).length > 0) {
      await saveAllImages(userId, companyId, item.id, images);
    }

    return NextResponse.json(item);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to save content" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { companyId, id, content } = body as {
      companyId?: string;
      id?: string;
      content?: SavedContentItem["content"];
    };

    if (!companyId || !id || !content) {
      return NextResponse.json(
        { error: "companyId, id, and content are required" },
        { status: 400 }
      );
    }

    const updated = await updateSavedContent(userId, companyId, id, content);

    if (!updated) {
      return NextResponse.json(
        { error: "Saved content not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to update saved content" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { companyId, id } = body as { companyId?: string; id?: string };

    if (!companyId || !id) {
      return NextResponse.json(
        { error: "companyId and id are required" },
        { status: 400 }
      );
    }

    const updated = await markCompleted(userId, companyId, id);

    if (!updated) {
      return NextResponse.json(
        { error: "Saved content not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to mark content as completed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const id = searchParams.get("id");

    if (!companyId || !id) {
      return NextResponse.json(
        { error: "companyId and id are required" },
        { status: 400 }
      );
    }

    const deleted = await deleteSavedContent(userId, companyId, id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Saved content not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to delete saved content" },
      { status: 500 }
    );
  }
}
