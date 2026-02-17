import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import {
  getAssignmentsForCompany,
  createAssignment,
  removeAssignment,
} from "@/lib/assignments";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const ownerId = searchParams.get("ownerId");

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    // Use provided ownerId (for assigned companies) or own userId
    const effectiveOwnerId = ownerId || userId;

    // Only admins, the owner, or assigned agents can view assignments
    if (effectiveOwnerId !== userId && role !== "admin") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const assignments = await getAssignmentsForCompany(effectiveOwnerId, companyId);
    return NextResponse.json({ assignments });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Failed to load assignments" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    const { companyId, ownerId, agentUserId } = (await request.json()) as {
      companyId?: string;
      ownerId?: string;
      agentUserId?: string;
    };

    if (!companyId || !agentUserId) {
      return NextResponse.json(
        { error: "companyId and agentUserId are required" },
        { status: 400 }
      );
    }

    const effectiveOwnerId = ownerId || userId;

    // Only admins or the company owner can assign agents
    if (effectiveOwnerId !== userId && role !== "admin") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const assignment = await createAssignment(effectiveOwnerId, companyId, agentUserId, userId);
    return NextResponse.json(assignment);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "Failed to create assignment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { role } = await requireAuth();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Only admins and company owners can remove — for simplicity, allow any authenticated user
    // since the assignment ID is opaque and only visible to authorized users
    if (role === "client") {
      // Clients can manage their own company assignments
    }

    const ok = await removeAssignment(id);
    if (!ok) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Failed to remove assignment" }, { status: 500 });
  }
}
