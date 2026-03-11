"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";

interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "agent" | "client";
  createdAt: string;
  createdBy: string | null;
}

interface InviteInfo {
  id: string;
  token: string;
  email: string | null;
  role: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
}

interface UserUsageSummary {
  userId: string;
  username: string;
  displayName: string;
  totalSpentCents: number;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  balanceCents: number;
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create user form
  const [showForm, setShowForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "agent" | "client">("client");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reset password
  const [resettingPasswordId, setResettingPasswordId] = useState<string | null>(null);
  const [resetTempPassword, setResetTempPassword] = useState("");
  const [resetPasswordError, setResetPasswordError] = useState("");
  const [resetPasswordSubmitting, setResetPasswordSubmitting] = useState(false);

  // Revoke invite confirmation
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Invites
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "agent" | "client">("client");
  const [inviteSendEmail, setInviteSendEmail] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [copiedUrl, setCopiedUrl] = useState("");
  const [ghlConfigured, setGhlConfigured] = useState(false);

  // Usage
  const [usageSummaries, setUsageSummaries] = useState<UserUsageSummary[]>([]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 403) {
        router.push("/");
        return;
      }
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      setUsers(data.users);
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [router]);

  const loadInvites = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/invites");
      if (!res.ok) return;
      const data = await res.json();
      setInvites(data.invites || []);
      setGhlConfigured(data.ghlConfigured || false);
    } catch {
      // ignore
    }
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/usage");
      if (!res.ok) return;
      const data = await res.json();
      setUsageSummaries(data.summaries || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadInvites();
    loadUsage();
  }, [loadUsers, loadInvites, loadUsage]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim() || !newDisplayName.trim() || !newPassword.trim()) return;
    setCreating(true);
    setFormError("");

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          displayName: newDisplayName,
          password: newPassword,
          role: newRole,
        }),
      });

      if (res.ok) {
        setNewUsername("");
        setNewDisplayName("");
        setNewPassword("");
        setNewRole("client");
        setShowForm(false);
        await loadUsers();
      } else {
        const data = await res.json();
        setFormError(data.error || "Failed to create user");
      }
    } catch {
      setFormError("Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteUser(id: string) {
    try {
      const res = await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== id));
      } else {
        const data = await res.json();
        setError(data.error || "Failed to delete user");
      }
    } catch {
      setError("Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleResetPassword(userId: string) {
    if (resetTempPassword.length < 8) {
      setResetPasswordError("Password must be at least 8 characters");
      return;
    }
    setResetPasswordSubmitting(true);
    setResetPasswordError("");

    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, newPassword: resetTempPassword }),
      });

      if (res.ok) {
        setResettingPasswordId(null);
        setResetTempPassword("");
      } else {
        const data = await res.json();
        setResetPasswordError(data.error || "Failed to reset password");
      }
    } catch {
      setResetPasswordError("Something went wrong");
    } finally {
      setResetPasswordSubmitting(false);
    }
  }

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setCreatingInvite(true);
    setInviteError("");

    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim() || undefined,
          role: inviteRole,
          sendEmail: inviteSendEmail && !!inviteEmail.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setCopiedUrl(data.inviteUrl);
        navigator.clipboard.writeText(data.inviteUrl).catch(() => {});
        setInviteEmail("");
        setInviteRole("client");
        setInviteSendEmail(false);
        setShowInviteForm(false);
        await loadInvites();
      } else {
        setInviteError(data.error || "Failed to create invite");
      }
    } catch {
      setInviteError("Something went wrong");
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(id: string) {
    try {
      const res = await fetch(`/api/admin/invites?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        await loadInvites();
      }
    } catch {
      // ignore
    } finally {
      setRevokingId(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-brand-primary border-t-transparent rounded-full" />
      </main>
    );
  }

  const pendingInvites = invites.filter((inv) => !inv.usedAt && new Date(inv.expiresAt) > new Date());
  const usedInvites = invites.filter((inv) => inv.usedAt);

  function formatCents(cents: number) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  const usageTotals = usageSummaries.reduce(
    (acc, s) => ({
      totalSpentCents: acc.totalSpentCents + s.totalSpentCents,
      totalRequests: acc.totalRequests + s.totalRequests,
      balanceCents: acc.balanceCents + s.balanceCents,
    }),
    { totalSpentCents: 0, totalRequests: 0, balanceCents: 0 }
  );

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
              <h1 className="text-3xl font-bold">User Management</h1>
              <p className="opacity-80 mt-1">Create and manage user accounts & invitations</p>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {copiedUrl && (
          <div className="mb-6 rounded-2xl bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 p-4 text-sm text-green-700 dark:text-green-300">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="font-medium">Invite created! Link copied to clipboard.</p>
                <p className="text-xs mt-1 font-mono break-all opacity-80">{copiedUrl}</p>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(copiedUrl);
                }}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition-colors"
              >
                Copy
              </button>
              <button
                onClick={() => setCopiedUrl("")}
                className="shrink-0 p-1 text-green-500 hover:text-green-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Invite Users Section */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden mb-6">
          <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
              Invitations ({pendingInvites.length} pending)
            </h2>
            <button
              onClick={() => setShowInviteForm(!showInviteForm)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Invite User
            </button>
          </div>

          {showInviteForm && (
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <form onSubmit={handleCreateInvite} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email (optional)</label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Role</label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as "admin" | "agent" | "client")}
                      className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none text-sm"
                    >
                      <option value="client">Client</option>
                      <option value="agent">Agent</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>

                {ghlConfigured && inviteEmail.trim() && (
                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={inviteSendEmail}
                      onChange={(e) => setInviteSendEmail(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-600 text-brand-primary focus:ring-brand-primary"
                    />
                    Send invite email via Go High Level
                  </label>
                )}

                {inviteError && (
                  <p className="text-sm text-red-500 flex items-center gap-1.5">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {inviteError}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={creatingInvite}
                    className="px-5 py-2.5 rounded-full bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {creatingInvite ? "Creating..." : "Generate Invite Link"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowInviteForm(false); setInviteError(""); }}
                    className="px-5 py-2.5 rounded-full bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {pendingInvites.length > 0 && (
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {pendingInvites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between p-4 px-6">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        {inv.email || "No email"}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        inv.role === "admin"
                          ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                          : inv.role === "agent"
                          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                          : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
                      }`}>
                        {inv.role}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium">
                        pending
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  {revokingId === inv.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-red-600 dark:text-red-400">Revoke?</span>
                      <button
                        onClick={() => handleRevokeInvite(inv.id)}
                        className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setRevokingId(null)}
                        className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setRevokingId(inv.id)}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                      title="Revoke invite"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {usedInvites.length > 0 && (
            <>
              <div className="px-6 py-2 bg-slate-50 dark:bg-slate-900/30 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Used invitations
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {usedInvites.slice(0, 5).map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between p-4 px-6 opacity-60">
                    <div>
                      <span className="text-sm text-slate-700 dark:text-slate-300">{inv.email || "No email"}</span>
                      <span className="text-xs text-slate-400 ml-2">
                        Used {inv.usedAt ? new Date(inv.usedAt).toLocaleDateString() : ""}
                      </span>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-medium">
                      used
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {pendingInvites.length === 0 && usedInvites.length === 0 && !showInviteForm && (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No invitations yet. Click &ldquo;Invite User&rdquo; to generate a signup link.
            </div>
          )}
        </div>

        {/* Users Section */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
              Users ({users.length})
            </h2>
            <button
              onClick={() => setShowForm(!showForm)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create User
            </button>
          </div>

          {showForm && (
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Username</label>
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="e.g. john"
                      className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Display Name</label>
                    <input
                      type="text"
                      value={newDisplayName}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                      placeholder="e.g. John Smith"
                      className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Role</label>
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as "admin" | "agent" | "client")}
                      className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none text-sm"
                    >
                      <option value="client">Client</option>
                      <option value="agent">Agent</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>

                {formError && (
                  <p className="text-sm text-red-500 flex items-center gap-1.5">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {formError}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={creating || !newUsername.trim() || !newDisplayName.trim() || !newPassword.trim()}
                    className="px-5 py-2.5 rounded-full bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {creating ? "Creating..." : "Create User"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowForm(false); setFormError(""); }}
                    className="px-5 py-2.5 rounded-full bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {users.map((user) => (
              <div key={user.id}>
                <div className="flex items-center justify-between p-4 px-6">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-brand-primary flex items-center justify-center text-white font-semibold text-sm">
                      {user.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 dark:text-slate-200">{user.displayName}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          user.role === "admin"
                            ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                            : user.role === "agent"
                            ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                            : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
                        }`}>
                          {user.role}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        @{user.username} &middot; Created {new Date(user.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {deletingId === user.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-red-600 dark:text-red-400">Delete?</span>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setResettingPasswordId(resettingPasswordId === user.id ? null : user.id);
                            setResetTempPassword("");
                            setResetPasswordError("");
                            setDeletingId(null);
                          }}
                          className="p-2 rounded-lg text-slate-400 hover:text-brand-primary hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                          title="Reset password"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => { setDeletingId(user.id); setResettingPasswordId(null); }}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                          title="Delete user"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {resettingPasswordId === user.id && (
                  <div className="px-6 pb-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider pt-3 mb-3">
                      Reset password for {user.displayName}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="password"
                        value={resetTempPassword}
                        onChange={(e) => { setResetTempPassword(e.target.value); setResetPasswordError(""); }}
                        placeholder="New temporary password (min 8 chars)"
                        autoFocus
                        className="flex-1 rounded-full border-0 bg-white dark:bg-slate-800 px-4 py-2.5 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none text-sm shadow-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleResetPassword(user.id)}
                          disabled={resetPasswordSubmitting || !resetTempPassword.trim()}
                          className="px-4 py-2.5 rounded-full bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {resetPasswordSubmitting ? "Saving..." : "Set Password"}
                        </button>
                        <button
                          onClick={() => { setResettingPasswordId(null); setResetTempPassword(""); setResetPasswordError(""); }}
                          className="px-4 py-2.5 rounded-full bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                    {resetPasswordError && (
                      <p className="text-sm text-red-500 mt-2 flex items-center gap-1.5">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {resetPasswordError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Usage & Credits Section */}
        {usageSummaries.length > 0 && (
          <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden mt-6">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">Usage &amp; Credits</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Platform-wide AI usage and credit balances</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/30 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="text-left px-6 py-3">User</th>
                    <th className="text-right px-6 py-3">Balance</th>
                    <th className="text-right px-6 py-3">Total Spent</th>
                    <th className="text-right px-6 py-3">Requests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {usageSummaries.map((s) => (
                    <tr key={s.userId} className={`${
                      s.balanceCents <= 0
                        ? "bg-red-50/40 dark:bg-red-900/10"
                        : s.balanceCents < 500
                        ? "bg-amber-50/40 dark:bg-amber-900/10"
                        : ""
                    }`}>
                      <td className="px-6 py-3">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{s.displayName}</div>
                        <div className="text-xs text-slate-400">@{s.username}</div>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <span className={`font-medium tabular-nums ${
                          s.balanceCents <= 0
                            ? "text-red-600 dark:text-red-400"
                            : s.balanceCents < 500
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-slate-700 dark:text-slate-300"
                        }`}>
                          {formatCents(s.balanceCents)}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCents(s.totalSpentCents)}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                        {s.totalRequests.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 dark:bg-slate-900/30 font-semibold border-t-2 border-slate-200 dark:border-slate-600">
                    <td className="px-6 py-3 text-slate-800 dark:text-slate-200">Total</td>
                    <td className="px-6 py-3 text-right tabular-nums text-slate-800 dark:text-slate-200">
                      {formatCents(usageTotals.balanceCents)}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums text-slate-800 dark:text-slate-200">
                      {formatCents(usageTotals.totalSpentCents)}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums text-slate-800 dark:text-slate-200">
                      {usageTotals.totalRequests.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
