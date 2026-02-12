import { supabase } from "@/lib/supabase";

export interface CreditBalance {
  balanceCents: number;
  totalToppedUpCents: number;
  totalSpentCents: number;
  updatedAt: string;
}

export async function getBalance(userId: string): Promise<CreditBalance> {
  const { data, error } = await supabase
    .from("user_credits")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return {
      balanceCents: 0,
      totalToppedUpCents: 0,
      totalSpentCents: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    balanceCents: data.balance_cents,
    totalToppedUpCents: data.total_topped_up_cents,
    totalSpentCents: data.total_spent_cents,
    updatedAt: data.updated_at,
  };
}

export async function addCredits(userId: string, amountCents: number): Promise<void> {
  const current = await getBalance(userId);

  const { error } = await supabase
    .from("user_credits")
    .upsert({
      user_id: userId,
      balance_cents: current.balanceCents + amountCents,
      total_topped_up_cents: current.totalToppedUpCents + amountCents,
      total_spent_cents: current.totalSpentCents,
      updated_at: new Date().toISOString(),
    });

  if (error) throw new Error(error.message);
}

export async function deductCredits(userId: string, amountCents: number): Promise<void> {
  const current = await getBalance(userId);

  const { error } = await supabase
    .from("user_credits")
    .upsert({
      user_id: userId,
      balance_cents: Math.max(0, current.balanceCents - amountCents),
      total_topped_up_cents: current.totalToppedUpCents,
      total_spent_cents: current.totalSpentCents + amountCents,
      updated_at: new Date().toISOString(),
    });

  if (error) throw new Error(error.message);
}

export async function logUsage(
  userId: string,
  route: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costCents: number
): Promise<void> {
  const { error } = await supabase
    .from("usage_logs")
    .insert({
      user_id: userId,
      route,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_cents: costCents,
    });

  if (error) console.error("Failed to log usage:", error.message);
}

export interface UsageLogEntry {
  id: string;
  route: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  createdAt: string;
}

export async function getUsageHistory(
  userId: string,
  limit = 50
): Promise<UsageLogEntry[]> {
  const { data, error } = await supabase
    .from("usage_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    route: row.route,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costCents: row.cost_cents,
    createdAt: row.created_at,
  }));
}

export interface PaymentEntry {
  id: string;
  stripeSessionId: string | null;
  amountCents: number;
  status: string;
  createdAt: string;
}

export async function getPaymentHistory(
  userId: string,
  limit = 20
): Promise<PaymentEntry[]> {
  const { data, error } = await supabase
    .from("payment_history")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    stripeSessionId: row.stripe_session_id,
    amountCents: row.amount_cents,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function recordPayment(
  userId: string,
  stripeSessionId: string,
  amountCents: number,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from("payment_history")
    .insert({
      user_id: userId,
      stripe_session_id: stripeSessionId,
      amount_cents: amountCents,
      status,
    });

  if (error) console.error("Failed to record payment:", error.message);
}
