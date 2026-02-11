import { NextRequest, NextResponse } from "next/server";
import { getContentPresets, addContentPreset, deleteContentPreset } from "@/lib/content-presets";
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

    const presets = await getContentPresets(userId, companyId);
    return NextResponse.json({ presets });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to load content presets" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { companyId, label, counts } = body as {
      companyId?: string;
      label?: string;
      counts?: Record<string, number>;
    };

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    if (!label || !counts) {
      return NextResponse.json(
        { error: "label and counts are required" },
        { status: 400 }
      );
    }

    const preset = await addContentPreset(userId, companyId, label, counts as import("@/types").ContentCounts);
    return NextResponse.json(preset);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to create content preset" },
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

    const deleted = await deleteContentPreset(userId, companyId, id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Content preset not found" },
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
      { error: "Failed to delete content preset" },
      { status: 500 }
    );
  }
}
