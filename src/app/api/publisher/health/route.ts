import { NextResponse } from "next/server";
import { requireAgentOrAdmin, AuthError } from "@/lib/auth-helpers";
import { checkPublisherIdentities } from "@/lib/publisher/identity-health";
import { readPublisherOwnership } from "@/lib/publisher/operator-repository";
import { publisherDispatchEnabled } from "@/lib/publisher/cron-gates";

export const dynamic = "force-dynamic";

const HEALTH_CACHE_MS = 30_000;
let cachedIdentities: { expiresAt: number; value: Awaited<ReturnType<typeof checkPublisherIdentities>> } | null = null;
let identityRequest: Promise<Awaited<ReturnType<typeof checkPublisherIdentities>>> | null = null;

async function cachedIdentityHealth() {
  if (cachedIdentities && cachedIdentities.expiresAt > Date.now()) return cachedIdentities.value;
  identityRequest ??= checkPublisherIdentities().finally(() => { identityRequest = null; });
  const value = await identityRequest;
  cachedIdentities = { expiresAt: Date.now() + HEALTH_CACHE_MS, value };
  return value;
}

export async function GET() {
  try {
    await requireAgentOrAdmin();
    const [ownership, identities] = await Promise.all([
      readPublisherOwnership(),
      cachedIdentityHealth(),
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
      platforms: identities.map(({ platform, configured, state }) => ({ platform, configured, state })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("publisher health read failed", error);
    return NextResponse.json({ error: "Publisher health is unavailable" }, { status: 503 });
  }
}
