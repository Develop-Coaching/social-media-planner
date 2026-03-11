"use client";

import { useState } from "react";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

export default function AccountPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setError(data.error || "Failed to change password");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center px-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="page" />
      </div>

      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-primary flex items-center justify-center mx-auto mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Change Password</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Update your account password</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm border border-slate-100 dark:border-slate-700">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Current Password
          </label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
            autoFocus
            required
            className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-700/60 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none mb-4"
          />

          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            New Password
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-700/60 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none mb-4"
          />

          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Confirm New Password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat new password"
            required
            className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-700/60 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none mb-4"
          />

          {error && (
            <p className="text-sm text-red-500 mb-4 flex items-center gap-1.5">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </p>
          )}

          {success && (
            <p className="text-sm text-green-600 dark:text-green-400 mb-4 flex items-center gap-1.5">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Password changed successfully
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !currentPassword || !newPassword || !confirmPassword}
            className="w-full rounded-full bg-brand-primary text-white px-6 py-3 font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
          >
            {loading ? "Updating..." : "Change Password"}
          </button>
        </form>

        <div className="text-center mt-6">
          <Link
            href="/"
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            &larr; Back to app
          </Link>
        </div>
      </div>
    </main>
  );
}
