"use client";

import { useState, useEffect, useRef } from "react";

export function ElapsedTimer({ className = "" }: { className?: string }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const display = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <span className={`text-xs tabular-nums text-slate-400 dark:text-slate-500 ${className}`}>
      {display}
    </span>
  );
}

interface SkeletonLineProps {
  className?: string;
  width?: string;
}

export function SkeletonLine({ className = "", width = "w-full" }: SkeletonLineProps) {
  return (
    <div className={`h-4 rounded-lg bg-slate-200 dark:bg-slate-700 animate-pulse ${width} ${className}`} />
  );
}

export function SkeletonCircle({ size = "w-10 h-10", className = "" }: { size?: string; className?: string }) {
  return (
    <div className={`rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse ${size} ${className}`} />
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm border border-slate-100 dark:border-slate-700 ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        <SkeletonCircle size="w-8 h-8" />
        <SkeletonLine width="w-40" />
      </div>
      <div className="space-y-3">
        <SkeletonLine />
        <SkeletonLine width="w-3/4" />
        <SkeletonLine width="w-5/6" />
      </div>
    </div>
  );
}

export function SkeletonContentBlock() {
  return (
    <div className="mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 animate-pulse">
      <div className="flex items-center justify-end gap-3 mb-3">
        <div className="h-5 w-24 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
      <div className="h-5 w-48 rounded bg-slate-200 dark:bg-slate-700 mb-3" />
      <div className="space-y-2">
        <div className="h-4 rounded bg-slate-200 dark:bg-slate-700 w-full" />
        <div className="h-4 rounded bg-slate-200 dark:bg-slate-700 w-full" />
        <div className="h-4 rounded bg-slate-200 dark:bg-slate-700 w-5/6" />
        <div className="h-4 rounded bg-slate-200 dark:bg-slate-700 w-4/6" />
      </div>
      <div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-700 mt-3" />
    </div>
  );
}

export function SkeletonSavedItem() {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 animate-pulse">
      <div className="flex-1 min-w-0">
        <div className="h-5 w-40 rounded bg-slate-200 dark:bg-slate-700 mb-2" />
        <div className="h-4 w-56 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
      <div className="flex items-center gap-2 ml-4">
        <div className="h-8 w-14 rounded-lg bg-slate-200 dark:bg-slate-700" />
        <div className="h-8 w-16 rounded-lg bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  );
}

export function SkeletonGenerating() {
  return (
    <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm border border-slate-100 dark:border-slate-700">
      <div className="flex items-center gap-3 mb-4">
        <SkeletonCircle size="w-8 h-8" />
        <SkeletonLine width="w-48" className="h-6" />
      </div>
      <div className="space-y-2">
        <SkeletonContentBlock />
        <SkeletonContentBlock />
      </div>
    </section>
  );
}
