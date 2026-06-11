"use client";

import { ReactNode } from "react";

/**
 * Wraps a header icon (Link or button) and shows an instant, styled label
 * below it on hover — clearer than the native `title` tooltip.
 */
export default function IconTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 dark:bg-slate-700"
      >
        {label}
      </span>
    </span>
  );
}
