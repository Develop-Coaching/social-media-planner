import { NextRequest, NextResponse } from "next/server";
import {
  getSavedContent,
  addSavedContent,
  deleteSavedContent,
  updateSavedContent,
  SavedContentItem,
} from "@/lib/saved-content";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const items = await getSavedContent(companyId);
    return NextResponse.json({ items });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to load saved content" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyId, name, theme, content } = body as {
      companyId?: string;
      name?: string;
      theme?: SavedContentItem["theme"];
      content?: SavedContentItem["content"];
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

    const item = await addSavedContent(companyId, name, theme, content);
    return NextResponse.json(item);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to save content" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
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

    const updated = await updateSavedContent(companyId, id, content);

    if (!updated) {
      return NextResponse.json(
        { error: "Saved content not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to update saved content" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const id = searchParams.get("id");

    if (!companyId || !id) {
      return NextResponse.json(
        { error: "companyId and id are required" },
        { status: 400 }
      );
    }

    const deleted = await deleteSavedContent(companyId, id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Saved content not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to delete saved content" },
      { status: 500 }
    );
  }
}
