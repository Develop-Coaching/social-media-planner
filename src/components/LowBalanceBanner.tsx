import Link from "next/link";

interface LowBalanceBannerProps {
  balanceCents: number;
  onDismiss?: () => void;
}

export default function LowBalanceBanner({ balanceCents, onDismiss }: LowBalanceBannerProps) {
  if (balanceCents > 200) return null;

  const isZero = balanceCents <= 0;
  const formattedBalance = `$${(balanceCents / 100).toFixed(2)}`;

  if (isZero) {
    return (
      <div className="rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-4 mb-6">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              You're out of credits
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">
              Please top up to continue generating content.
            </p>
          </div>
          <Link
            href="/billing"
            className="shrink-0 px-4 py-2 rounded-full bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Top Up
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 mb-6">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            Your credit balance is low ({formattedBalance} remaining)
          </p>
          <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">
            Top up to keep generating content.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/billing"
            className="px-4 py-2 rounded-full bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
          >
            Top Up
          </Link>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1.5 rounded-lg text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
              title="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
