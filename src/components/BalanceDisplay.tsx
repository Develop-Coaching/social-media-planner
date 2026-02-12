import Link from "next/link";

interface BalanceDisplayProps {
  balanceCents: number;
  headerTextLight?: boolean;
}

export default function BalanceDisplay({ balanceCents, headerTextLight }: BalanceDisplayProps) {
  const formatted = `$${(balanceCents / 100).toFixed(2)}`;
  const isLow = balanceCents <= 200;
  const isZero = balanceCents <= 0;

  return (
    <Link
      href="/billing"
      title="View billing & top up"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
        isZero
          ? "bg-red-500/20 text-red-100 hover:bg-red-500/30"
          : isLow
          ? "bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
          : headerTextLight
          ? "bg-black/10 text-slate-700 hover:bg-black/20"
          : "bg-white/10 text-white/90 hover:bg-white/20"
      }`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {formatted}
    </Link>
  );
}
