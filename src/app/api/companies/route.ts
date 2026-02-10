import { NextRequest, NextResponse } from "next/server";
import { getCompanies, addCompany, updateCompany, deleteCompany } from "@/lib/companies";
import { requireAuth, AuthError } from "@/lib/auth-helpers";

export async function GET() {
  try {
    const { userId } = await requireAuth();
    const companies = await getCompanies(userId);
    return NextResponse.json({ companies });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "Failed to load companies" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { name } = body as { name?: string };

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const company = await addCompany(userId, name.trim());
    return NextResponse.json(company);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    const message = e instanceof Error ? e.message : "Failed to add company";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const body = await request.json();
    const { id, ...updates } = body as { id: string; name?: string; logo?: string; brandColors?: string[]; character?: string };

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Validate logo size (max ~2MB base64)
    if (updates.logo && updates.logo.length > 3_000_000) {
      return NextResponse.json({ error: "Logo too large (max 2MB)" }, { status: 400 });
    }

    // Validate brand colors (max 6)
    if (updates.brandColors && updates.brandColors.length > 6) {
      return NextResponse.json({ error: "Maximum 6 brand colors allowed" }, { status: 400 });
    }

    const updated = await updateCompany(userId, id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Failed to update company" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const removed = await deleteCompany(userId, id);

    if (!removed) {
      return NextResponse.json(
        { error: "Company not found" },
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
      { error: "Failed to delete company" },
      { status: 500 }
    );
  }
}
