import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/auth-helpers";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export interface UserUsageSummary {
  userId: string;
  username: string;
  displayName: string;
  totalSpentCents: number;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  balanceCents: number;
}

export async function GET() {
  try {
    await requireAdmin();

    // Fetch all users
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, username, display_name");
    if (usersError) throw new Error(usersError.message);

    // Fetch usage_logs grouped by user_id
    const { data: logs, error: logsError } = await supabase
      .from("usage_logs")
      .select("user_id, cost_cents, input_tokens, output_tokens");
    if (logsError) throw new Error(logsError.message);

    // Fetch all credit balances
    const { data: credits, error: creditsError } = await supabase
      .from("user_credits")
      .select("user_id, balance_cents");
    if (creditsError) throw new Error(creditsError.message);

    // Aggregate usage per user
    const usageMap = new Map<
      string,
      { totalSpentCents: number; totalRequests: number; inputTokens: number; outputTokens: number }
    >();
    for (const log of logs ?? []) {
      const entry = usageMap.get(log.user_id) ?? {
        totalSpentCents: 0,
        totalRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      entry.totalSpentCents += log.cost_cents ?? 0;
      entry.totalRequests += 1;
      entry.inputTokens += log.input_tokens ?? 0;
      entry.outputTokens += log.output_tokens ?? 0;
      usageMap.set(log.user_id, entry);
    }

    const creditMap = new Map<string, number>(
      (credits ?? []).map((c) => [c.user_id, c.balance_cents ?? 0])
    );

    const userMap = new Map(
      (users ?? []).map((u) => [u.id, { username: u.username, displayName: u.display_name }])
    );

    // Collect all user IDs that appear in usage or credits (plus all users)
    const allIds = new Set<string>([
      ...(users ?? []).map((u) => u.id),
      ...usageMap.keys(),
      ...creditMap.keys(),
    ]);

    const summaries: UserUsageSummary[] = Array.from(allIds)
      .map((userId) => {
        const info = userMap.get(userId);
        const usage = usageMap.get(userId) ?? {
          totalSpentCents: 0,
          totalRequests: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        return {
          userId,
          username: info?.username ?? userId,
          displayName: info?.displayName ?? userId,
          totalSpentCents: usage.totalSpentCents,
          totalRequests: usage.totalRequests,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          balanceCents: creditMap.get(userId) ?? 0,
        };
      })
      .sort((a, b) => b.totalSpentCents - a.totalSpentCents);

    return NextResponse.json({ summaries });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Failed to load usage" }, { status: 500 });
  }
}
