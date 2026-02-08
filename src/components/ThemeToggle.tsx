"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark" | "system";

export default function ThemeToggle({ variant = "header" }: { variant?: "header" | "page" }) {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("theme") as ThemeMode | null;
    if (saved && ["light", "dark", "system"].includes(saved)) {
      setMode(saved);
      applyTheme(saved);
    } else {
      applyTheme("system");
    }
  }, []);

  function applyTheme(m: ThemeMode) {
    const isDark =
      m === "dark" || (m === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
  }

  function cycleMode() {
    const next: ThemeMode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
    setMode(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  }

  // Listen for system preference changes when in system mode
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handler() {
      if (mode === "system") applyTheme("system");
    }
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  if (!mounted) return null;

  return (
    <button
      onClick={cycleMode}
      className={`p-2 rounded-lg transition-colors ${
        variant === "page"
          ? "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
          : "text-indigo-100 hover:text-white hover:bg-white/10"
      }`}
      title={`Theme: ${mode}`}
    >
      {mode === "light" && (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )}
      {mode === "dark" && (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
      {mode === "system" && (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}
