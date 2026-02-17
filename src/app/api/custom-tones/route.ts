import { NextRequest, NextResponse } from "next/server";
import { getCustomTones, addCustomTone, deleteCustomTone } from "@/lib/custom-tones";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { resolveCompanyAccess, CompanyAccessError } from "@/lib/company-access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);
    const tones = await getCustomTones(effectiveUserId, companyId);
    return NextResponse.json({ tones });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof CompanyAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to load custom tones" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const body = await request.json();
    const { companyId, label, prompt } = body as {
      companyId?: string;
      label?: string;
      prompt?: string;
    };

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }

    if (!label || !prompt) {
      return NextResponse.json(
        { error: "label and prompt are required" },
        { status: 400 }
      );
    }

    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);
    const tone = await addCustomTone(effectiveUserId, companyId, label, prompt);
    return NextResponse.json(tone);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof CompanyAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to create custom tone" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const id = searchParams.get("id");

    if (!companyId || !id) {
      return NextResponse.json(
        { error: "companyId and id are required" },
        { status: 400 }
      );
    }

    const { effectiveUserId } = await resolveCompanyAccess(userId, role, companyId);
    const deleted = await deleteCustomTone(effectiveUserId, companyId, id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Custom tone not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof CompanyAccessError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to delete custom tone" },
      { status: 500 }
    );
  }
}
