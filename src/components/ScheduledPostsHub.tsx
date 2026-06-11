"use client";

import { useState, useEffect, useCallback } from "react";

interface ScheduledPost {
  id: string;
  content_type: string;
  caption: string;
  platforms: string[];
  scheduled_at: string;
  status: "queued" | "publishing" | "published" | "failed" | "cancelled";
  platform_post_ids: Record<string, string>;
  error: string | null;
  published_at: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  publishing: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  published: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  failed: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  cancelled: "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400",
};

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ScheduledPostsHub({ companyId }: { companyId: string }) {
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/scheduled-posts?companyId=${encodeURIComponent(companyId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setPosts(data.posts || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scheduled posts");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const cancelPost = async (id: string) => {
    try {
      const res = await fetch(
        `/api/scheduled-posts?id=${id}&companyId=${encodeURIComponent(companyId)}`,
        { method: "DELETE" }
      );
      if (res.ok) load();
    } catch {
      // non-fatal
    }
  };

  const filtered = filter === "all" ? posts : posts.filter((p) => p.status === filter);
  const counts = {
    queued: posts.filter((p) => p.status === "queued").length,
    published: posts.filter((p) => p.status === "published").length,
    failed: posts.filter((p) => p.status === "failed").length,
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm border border-slate-100 dark:border-slate-700">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Scheduled posts</h2>
        <button
          onClick={load}
          className="text-xs font-medium text-brand-primary hover:underline"
        >
          Refresh
        </button>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Everything queued to auto-publish, and what&apos;s already gone out.
        {counts.queued > 0 && ` ${counts.queued} waiting to post.`}
      </p>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {["all", "queued", "published", "failed", "cancelled"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              filter === s
                ? "border-brand-primary bg-brand-primary-light text-brand-primary"
                : "border-gray-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nothing here yet. Go to <span className="font-semibold">Calendar</span>, click a post, and schedule it to publish.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((post) => (
            <div
              key={post.id}
              className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[post.status]}`}>
                    {post.status}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {post.status === "published" && post.published_at
                      ? `Posted ${formatWhen(post.published_at)}`
                      : formatWhen(post.scheduled_at)}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    · {post.platforms.map((p) => PLATFORM_LABEL[p] || p).join(", ")}
                  </span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300 line-clamp-2">
                  {post.caption || `(${post.content_type})`}
                </p>
                {post.status === "failed" && post.error && (
                  <p className="text-xs text-red-500 dark:text-red-400 mt-1 line-clamp-2">{post.error}</p>
                )}
              </div>
              {(post.status === "queued" || post.status === "failed") && (
                <button
                  onClick={() => cancelPost(post.id)}
                  className="text-xs font-medium text-slate-400 hover:text-red-500 dark:hover:text-red-400 flex-shrink-0"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
