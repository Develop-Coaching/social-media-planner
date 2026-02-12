import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-helpers";
import { getBalance, getUsageHistory, getPaymentHistory } from "@/lib/credits";
import { isCreditsEnabled } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId } = await requireAuth();

    const creditsEnabled = isCreditsEnabled();

    if (!creditsEnabled) {
      return NextResponse.json({
        creditsEnabled: false,
        balance: { balanceCents: 0, totalToppedUpCents: 0, totalSpentCents: 0 },
        usage: [],
        payments: [],
      });
    }

    const [balance, usage, payments] = await Promise.all([
      getBalance(userId),
      getUsageHistory(userId, 50),
      getPaymentHistory(userId, 20),
    ]);

    return NextResponse.json({
      creditsEnabled: true,
      balance,
      usage,
      payments,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Failed to load billing data" }, { status: 500 });
  }
}
