import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function handleError(e: unknown): NextResponse {
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof CompanyAccessError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error("research/ideas error:", e);
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

    const { data, error } = await supabase
      .from("research_ideas")
      .select("*")
      .eq("user_id", effectiveUserId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ideas: data ?? [] });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const body = await request.json();
    const { companyId, niche, type, title, payload, draft } = body as {
      companyId?: string;
      niche?: string;
      type?: string;
      title?: string;
      payload?: unknown;
      draft?: unknown;
    };

    if (!companyId || !niche || !type || !title || !payload) {
      return NextResponse.json(
        { error: "companyId, niche, type, title and payload are required" },
        { status: 400 }
      );
    }
    if (type !== "trend" && type !== "format") {
      return NextResponse.json({ error: "type must be trend or format" }, { status: 400 });
    }
    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);

    const { data, error } = await supabase
      .from("research_ideas")
      .insert({
        user_id: effectiveUserId,
        company_id: companyId,
        niche,
        type,
        title,
        payload,
        draft: draft ?? null,
        status: draft ? "drafted" : "new",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ idea: data });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const body = await request.json();
    const { companyId, id, status, draft } = body as {
      companyId?: string;
      id?: string;
      status?: string;
      draft?: unknown;
    };

    if (!companyId || !id) {
      return NextResponse.json({ error: "companyId and id are required" }, { status: 400 });
    }
    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);

    const patch: Record<string, unknown> = {};
    if (status) {
      if (!["new", "drafted", "used", "archived"].includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      patch.status = status;
    }
    if (draft !== undefined) {
      patch.draft = draft;
      if (!status) patch.status = "drafted";
    }

    const { data, error } = await supabase
      .from("research_ideas")
      .update(patch)
      .eq("id", id)
      .eq("user_id", effectiveUserId)
      .eq("company_id", companyId)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    return NextResponse.json({ idea: data });
  } catch (e) {
    return handleError(e);
  }
}
