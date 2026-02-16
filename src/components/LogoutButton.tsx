"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

export default function LogoutButton({ variant = "header" }: { variant?: "header" | "page" }) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    // Check if user is authenticated via API (cookie is httpOnly so JS can't read it)
    fetch("/api/auth/me")
      .then((res) => setVisible(res.ok))
      .catch(() => setVisible(false));
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (!visible) return null;

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className={`p-2 rounded-lg transition-colors ${
          variant === "page"
            ? "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
            : "text-current opacity-80 hover:opacity-100 hover:bg-white/10"
        }`}
        title="Sign out"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 max-w-sm mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/50">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-lg">Sign out?</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              Are you sure you want to sign out? You will need to enter your credentials to sign back in.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 rounded-full bg-red-600 text-white font-medium hover:bg-red-700 transition-colors text-sm"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
