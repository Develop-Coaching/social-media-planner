import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { checkPublisherIdentities } from "@/lib/publisher/identity-health";
import { readPublisherOwnership } from "@/lib/publisher/operator-repository";
import { publisherDispatchEnabled } from "@/lib/publisher/cron-gates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const [ownership, identities] = await Promise.all([
      readPublisherOwnership(),
      checkPublisherIdentities(),
    ]);
    return NextResponse.json({
      dispatchEnabled: publisherDispatchEnabled(),
      configuredEpoch: Number.isSafeInteger(Number(process.env.PUBLISHER_OWNERSHIP_EPOCH))
        ? Number(process.env.PUBLISHER_OWNERSHIP_EPOCH)
        : null,
      ownership: {
        owner: ownership.owner,
        epoch: ownership.epoch,
        cutoffAt: ownership.cutoff_at,
        reconciled: !!ownership.reconciliation_sha256,
      },
      platforms: identities.map(({ platform, configured, state, missingPermissions, detail }) => ({
        platform, configured, state, missingPermissions, detail,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("publisher health read failed", error);
    return NextResponse.json({ error: "Publisher health is unavailable" }, { status: 503 });
  }
}
