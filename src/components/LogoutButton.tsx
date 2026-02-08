"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

export default function LogoutButton({ variant = "header" }: { variant?: "header" | "page" }) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Check if auth is enabled by trying the logout endpoint
    // If we're on a page (not /login), auth must be enabled or disabled
    // We show logout only if the session cookie exists
    const hasCookie = document.cookie.includes("pc_session=");
    setVisible(hasCookie);
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (!visible) return null;

  return (
    <button
      onClick={handleLogout}
      className={`p-2 rounded-lg transition-colors ${
        variant === "page"
          ? "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
          : "text-indigo-100 hover:text-white hover:bg-white/10"
      }`}
      title="Sign out"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    </button>
  );
}
