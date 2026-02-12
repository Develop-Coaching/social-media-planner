"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";

interface Balance {
  balanceCents: number;
  totalToppedUpCents: number;
  totalSpentCents: number;
}

interface UsageEntry {
  id: string;
  route: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  createdAt: string;
}

interface PaymentEntry {
  id: string;
  amountCents: number;
  status: string;
  createdAt: string;
}

const PACKAGES = [
  { label: "$10", cents: 1000 },
  { label: "$25", cents: 2500 },
  { label: "$50", cents: 5000 },
  { label: "$100", cents: 10000 },
];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatRoute(route: string): string {
  return route
    .replace("/api/", "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function BillingPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-brand-primary border-t-transparent rounded-full" />
      </main>
    }>
      <BillingContent />
    </Suspense>
  );
}

function BillingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<Balance>({ balanceCents: 0, totalToppedUpCents: 0, totalSpentCents: 0 });
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [creditsEnabled, setCreditsEnabled] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  const loadBilling = useCallback(async () => {
    try {
      const res = await fetch("/api/billing");
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error("Failed to load billing");
      const data = await res.json();
      setCreditsEnabled(data.creditsEnabled);
      setBalance(data.balance);
      setUsage(data.usage || []);
      setPayments(data.payments || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadBilling();
    if (searchParams.get("success") === "true") {
      setSuccessMessage("Payment successful! Your credits have been added.");
      // Refresh after a moment to pick up webhook credits
      setTimeout(() => loadBilling(), 2000);
    }
  }, [loadBilling, searchParams]);

  async function handleCheckout(packageCents: number) {
    setCheckoutLoading(packageCents);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageCents }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || "Failed to start checkout");
      }
    } catch {
      alert("Failed to start checkout");
    } finally {
      setCheckoutLoading(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-brand-primary border-t-transparent rounded-full" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <header className="bg-brand-primary text-white">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 opacity-80 hover:opacity-100 mb-4 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to app
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Billing & Credits</h1>
              <p className="opacity-80 mt-1">Manage your credit balance and view usage</p>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {successMessage && (
          <div className="mb-6 rounded-2xl bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 p-4 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {successMessage}
          </div>
        )}

        {!creditsEnabled && (
          <div className="mb-6 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-700 dark:text-amber-300">
            Credits system is not configured. Set STRIPE_SECRET_KEY to enable billing.
          </div>
        )}

        {/* Balance Card */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">Current Balance</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center p-4 rounded-2xl bg-brand-primary/5 dark:bg-brand-primary/10">
              <p className="text-3xl font-bold text-brand-primary">{formatCents(balance.balanceCents)}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Available</p>
            </div>
            <div className="text-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50">
              <p className="text-2xl font-bold text-slate-700 dark:text-slate-300">{formatCents(balance.totalToppedUpCents)}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Total Topped Up</p>
            </div>
            <div className="text-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50">
              <p className="text-2xl font-bold text-slate-700 dark:text-slate-300">{formatCents(balance.totalSpentCents)}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Total Spent</p>
            </div>
          </div>
        </div>

        {/* Top Up Packages */}
        {creditsEnabled && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">Top Up Credits</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PACKAGES.map((pkg) => (
                <button
                  key={pkg.cents}
                  onClick={() => handleCheckout(pkg.cents)}
                  disabled={checkoutLoading !== null}
                  className={`p-4 rounded-2xl border-2 transition-all text-center ${
                    checkoutLoading === pkg.cents
                      ? "border-brand-primary bg-brand-primary/10"
                      : "border-slate-200 dark:border-slate-600 hover:border-brand-primary"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <p className="text-2xl font-bold text-slate-800 dark:text-slate-200">{pkg.label}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {checkoutLoading === pkg.cents ? "Redirecting..." : "Top up"}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Payment History */}
        {payments.length > 0 && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden mb-6">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Payment History</h2>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-4 px-6">
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      Credit top-up
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {new Date(p.createdAt).toLocaleDateString()} {new Date(p.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      p.status === "completed"
                        ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
                    }`}>
                      {p.status}
                    </span>
                    <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                      +{formatCents(p.amountCents)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Usage History */}
        {usage.length > 0 && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Recent Usage</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                    <th className="px-6 py-3 font-medium">Action</th>
                    <th className="px-6 py-3 font-medium">Model</th>
                    <th className="px-6 py-3 font-medium text-right">Tokens</th>
                    <th className="px-6 py-3 font-medium text-right">Cost</th>
                    <th className="px-6 py-3 font-medium text-right">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {usage.map((u) => (
                    <tr key={u.id} className="text-slate-700 dark:text-slate-300">
                      <td className="px-6 py-3">{formatRoute(u.route)}</td>
                      <td className="px-6 py-3 text-xs font-mono text-slate-500 dark:text-slate-400">
                        {u.model.replace("claude-sonnet-4-20250514", "Sonnet 4").replace("gemini-3-pro-image-preview", "Gemini")}
                      </td>
                      <td className="px-6 py-3 text-right text-xs text-slate-500 dark:text-slate-400">
                        {(u.inputTokens + u.outputTokens).toLocaleString()}
                      </td>
                      <td className="px-6 py-3 text-right font-medium">
                        {formatCents(u.costCents)}
                      </td>
                      <td className="px-6 py-3 text-right text-xs text-slate-500 dark:text-slate-400">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
