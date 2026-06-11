import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";
import {
  listScheduledPosts,
  createScheduledPost,
  updateScheduledPost,
  cancelScheduledPost,
} from "@/lib/scheduled-posts";
import type { Platform } from "@/lib/publish/types";

export const dynamic = "force-dynamic";

const VALID_PLATFORMS: Platform[] = ["instagram", "facebook", "linkedin"];

function handleError(e: unknown): NextResponse {
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof CompanyAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("scheduled-posts error:", e);
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "Request failed" },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const companyId = request.nextUrl.searchParams.get("companyId");
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }
    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);
    const posts = await listScheduledPosts(effectiveUserId, companyId);
    return NextResponse.json({ posts });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const body = await request.json();
    const {
      companyId,
      savedContentId,
      itemId,
      contentType,
      caption,
      imageKeys,
      mediaUrls,
      uploadPaths,
      videoUrl,
      platforms,
      scheduledAt,
    } = body as {
      companyId?: string;
      savedContentId?: string;
      itemId?: string;
      contentType?: string;
      caption?: string;
      imageKeys?: string[];
      mediaUrls?: string[];
      uploadPaths?: string[];
      videoUrl?: string;
      platforms?: Platform[];
      scheduledAt?: string;
    };

    if (!companyId || !scheduledAt || !platforms?.length) {
      return NextResponse.json(
        { error: "companyId, scheduledAt and platforms are required" },
        { status: 400 }
      );
    }
    if (platforms.some((p) => !VALID_PLATFORMS.includes(p))) {
      return NextResponse.json(
        { error: `platforms must be a subset of ${VALID_PLATFORMS.join(", ")}` },
        { status: 400 }
      );
    }
    if (Number.isNaN(Date.parse(scheduledAt))) {
      return NextResponse.json({ error: "scheduledAt must be a valid ISO date" }, { status: 400 });
    }
    if (Date.parse(scheduledAt) <= Date.now() - 60_000) {
      return NextResponse.json({ error: "Scheduled time must be in the future" }, { status: 400 });
    }

    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);

    const post = await createScheduledPost({
      user_id: effectiveUserId,
      company_id: companyId,
      saved_content_id: savedContentId ?? null,
      item_id: itemId ?? null,
      content_type: contentType ?? "post",
      caption: caption ?? "",
      image_keys: imageKeys ?? [],
      media_urls: mediaUrls ?? [],
      upload_paths: uploadPaths ?? [],
      video_url: videoUrl ?? null,
      platforms,
      scheduled_at: new Date(scheduledAt).toISOString(),
    });

    return NextResponse.json({ post });
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const body = await request.json();
    const { id, companyId, ...rest } = body as {
      id?: string;
      companyId?: string;
      caption?: string;
      platforms?: Platform[];
      scheduledAt?: string;
    };

    if (!id || !companyId) {
      return NextResponse.json({ error: "id and companyId are required" }, { status: 400 });
    }
    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);

    const patch: Record<string, unknown> = {};
    if (typeof rest.caption === "string") patch.caption = rest.caption;
    if (rest.platforms?.length) patch.platforms = rest.platforms;
    if (rest.scheduledAt) {
      if (Number.isNaN(Date.parse(rest.scheduledAt))) {
        return NextResponse.json({ error: "scheduledAt must be a valid ISO date" }, { status: 400 });
      }
      if (Date.parse(rest.scheduledAt) <= Date.now() - 60_000) {
        return NextResponse.json({ error: "Scheduled time must be in the future" }, { status: 400 });
      }
      patch.scheduled_at = new Date(rest.scheduledAt).toISOString();
      // Re-queue a failed/cancelled post when it gets a new date
      patch.status = "queued";
    }

    const post = await updateScheduledPost(id, effectiveUserId, companyId, patch);
    if (!post) {
      return NextResponse.json(
        { error: "Post not found or no longer editable" },
        { status: 404 }
      );
    }
    return NextResponse.json({ post });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const id = request.nextUrl.searchParams.get("id");
    const companyId = request.nextUrl.searchParams.get("companyId");
    if (!id || !companyId) {
      return NextResponse.json({ error: "id and companyId are required" }, { status: 400 });
    }
    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);
    const cancelled = await cancelScheduledPost(id, effectiveUserId, companyId);
    if (!cancelled) {
      return NextResponse.json(
        { error: "Post not found or already published" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
