import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth-helpers";
import { createInvite, getInvites, revokeInvite } from "@/lib/invites";
import { sendInviteEmail, isGhlConfigured } from "@/lib/ghl";
import { getUserById } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const invites = await getInvites();
    const ghlConfigured = isGhlConfigured();
    return NextResponse.json({ invites, ghlConfigured });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Failed to load invites" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireAdmin();
    const { email, role, sendEmail } = (await request.json()) as {
      email?: string;
      role?: "admin" | "user";
      sendEmail?: boolean;
    };

    const invite = await createInvite(email || null, role || "user", userId);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const inviteUrl = `${appUrl}/signup/${invite.token}`;

    // Send email via GHL if requested and configured
    let emailSent = false;
    if (sendEmail && email && isGhlConfigured()) {
      const user = await getUserById(userId);
      emailSent = await sendInviteEmail(email, inviteUrl, user?.displayName || "Admin");
    }

    return NextResponse.json({ invite, inviteUrl, emailSent });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to create invite" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin();
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const ok = await revokeInvite(id);
    if (!ok) return NextResponse.json({ error: "Failed to revoke" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Failed to revoke invite" }, { status: 500 });
  }
}
