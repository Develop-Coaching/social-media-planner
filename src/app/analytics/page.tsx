"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";

interface MetricRow {
  platform: "instagram" | "facebook" | "linkedin";
  platform_post_id: string;
  posted_at: string | null;
  content_snippet: string;
  content_type: string | null;
  permalink: string | null;
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  video_views: number;
  engagement_rate: number;
}

const PLATFORM_BADGES: Record<string, string> = {
  instagram: "bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300",
  facebook: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  linkedin: "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300",
};

type SortKey = "posted_at" | "reach" | "likes" | "comments" | "engagement_rate";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function num(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function interactions(r: MetricRow): number {
  return r.likes + r.comments + r.shares + r.saves;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-sm border border-slate-100 dark:border-slate-700">
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-slate-800 dark:text-slate-200 mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-1">{sub}</p>}
    </div>
  );
}

function BarChart({ data, color }: { data: { label: string; value: number }[]; color: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = 100 / data.length;
  return (
    <svg viewBox="0 0 100 46" className="w-full h-40" preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.value / max) * 36;
        return (
          <g key={i}>
            <rect
              x={i * barWidth + barWidth * 0.15}
              y={40 - h}
              width={barWidth * 0.7}
              height={h}
              rx={1}
              className={color}
            />
            <text
              x={i * barWidth + barWidth * 0.5}
              y={45}
              textAnchor="middle"
              className="fill-slate-400 dark:fill-slate-500"
              style={{ fontSize: "3px" }}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function AnalyticsPage() {
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("posted_at");

  const load = async () => {
    try {
      const res = await fetch("/api/analytics/posts");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setRows(data.posts || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/analytics/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      const parts: string[] = [];
      for (const platform of ["instagram", "facebook", "linkedin"] as const) {
        const r = data[platform];
        if (!r) continue;
        parts.push(r.error ? `${platform}: ${r.error}` : `${platform}: ${r.synced} synced`);
      }
      setSyncMessage(parts.join(" · "));
      await load();
    } catch (e) {
      setSyncMessage(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(
    () => (platformFilter === "all" ? rows : rows.filter((r) => r.platform === platformFilter)),
    [rows, platformFilter]
  );

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      if (sortKey === "posted_at") {
        return (b.posted_at ?? "").localeCompare(a.posted_at ?? "");
      }
      return (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
    });
    return copy;
  }, [filtered, sortKey]);

  const stats = useMemo(() => {
    const totalReach = filtered.reduce((s, r) => s + (r.reach || r.impressions), 0);
    const totalEngagement = filtered.reduce((s, r) => s + interactions(r), 0);
    const withRate = filtered.filter((r) => r.engagement_rate > 0);
    const avgRate = withRate.length
      ? withRate.reduce((s, r) => s + r.engagement_rate, 0) / withRate.length
      : 0;
    const best = [...filtered].sort((a, b) => b.engagement_rate - a.engagement_rate)[0];
    return { totalReach, totalEngagement, avgRate, best };
  }, [filtered]);

  const topPosts = useMemo(
    () =>
      [...filtered]
        .filter((r) => interactions(r) > 0)
        .sort((a, b) => b.engagement_rate - a.engagement_rate)
        .slice(0, 5),
    [filtered]
  );

  const byDay = useMemo(() => {
    const sums = Array(7).fill(0);
    const counts = Array(7).fill(0);
    for (const r of filtered) {
      if (!r.posted_at) continue;
      const day = new Date(r.posted_at).getDay();
      sums[day] += interactions(r);
      counts[day]++;
    }
    // Mon-first ordering
    return [1, 2, 3, 4, 5, 6, 0].map((d) => ({
      label: DAY_NAMES[d],
      value: counts[d] ? Math.round(sums[d] / counts[d]) : 0,
    }));
  }, [filtered]);

  const byPlatform = useMemo(
    () =>
      (["instagram", "facebook", "linkedin"] as const).map((p) => ({
        label: p === "instagram" ? "IG" : p === "facebook" ? "FB" : "LI",
        value: rows.filter((r) => r.platform === p).reduce((s, r) => s + interactions(r), 0),
      })),
    [rows]
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <header className="bg-brand-primary text-white">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <Link href="/" className="text-sm text-white/80 hover:text-white transition-colors">
              ← Back to dashboard
            </Link>
            <h1 className="text-2xl font-bold mt-1">Analytics</h1>
            <p className="text-sm text-white/80">What&apos;s working across your platforms</p>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 text-sm font-medium rounded-full bg-white/15 hover:bg-white/25 transition-colors disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {syncMessage && (
          <p className="text-sm text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-full px-4 py-2 border border-slate-100 dark:border-slate-700">
            {syncMessage}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-full px-4 py-2 border border-red-200 dark:border-red-800">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-slate-500 dark:text-slate-400 text-center py-16">Loading metrics...</p>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-600 dark:text-slate-300 font-medium mb-2">No metrics yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Hit &ldquo;Sync now&rdquo; to pull your recent posts from Instagram, Facebook and LinkedIn.
            </p>
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total reach" value={num(stats.totalReach)} />
              <StatCard label="Total engagement" value={num(stats.totalEngagement)} />
              <StatCard label="Avg engagement rate" value={`${stats.avgRate.toFixed(1)}%`} />
              <StatCard
                label="Best post"
                value={stats.best ? `${stats.best.engagement_rate.toFixed(1)}%` : "—"}
                sub={stats.best?.content_snippet.split("\n")[0]}
              />
            </div>

            {/* Charts */}
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-sm border border-slate-100 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                  Avg engagement by posting day
                </h3>
                <BarChart data={byDay} color="fill-brand-primary" />
              </div>
              <div className="rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-sm border border-slate-100 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                  Total engagement by platform
                </h3>
                <BarChart data={byPlatform} color="fill-sky-500" />
              </div>
            </div>

            {/* What's working */}
            <div className="rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-sm border border-slate-100 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                What&apos;s working — top hooks by engagement rate
              </h3>
              {topPosts.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Not enough data yet.</p>
              ) : (
                <ol className="space-y-2">
                  {topPosts.map((r, i) => (
                    <li key={`${r.platform}-${r.platform_post_id}`} className="flex items-start gap-3">
                      <span className="text-lg font-bold text-slate-300 dark:text-slate-600 w-5">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm text-slate-800 dark:text-slate-200 line-clamp-2">
                          {r.content_snippet.split("\n")[0] || "(no text)"}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold mr-2 ${PLATFORM_BADGES[r.platform]}`}>
                            {r.platform}
                          </span>
                          {r.engagement_rate.toFixed(1)}% · {num(interactions(r))} interactions · {num(r.reach || r.impressions)} reach
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Table */}
            <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
              <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">All posts ({filtered.length})</h3>
                <div className="flex items-center gap-2">
                  {["all", "instagram", "facebook", "linkedin"].map((p) => (
                    <button
                      key={p}
                      onClick={() => setPlatformFilter(p)}
                      className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                        platformFilter === p
                          ? "border-brand-primary bg-brand-primary-light text-brand-primary"
                          : "border-gray-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {p === "all" ? "All" : p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      <th className="px-5 py-3">Post</th>
                      {(
                        [
                          ["posted_at", "Date"],
                          ["reach", "Reach"],
                          ["likes", "Likes"],
                          ["comments", "Comments"],
                          ["engagement_rate", "Eng. rate"],
                        ] as [SortKey, string][]
                      ).map(([key, label]) => (
                        <th
                          key={key}
                          className="px-3 py-3 cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 whitespace-nowrap"
                          onClick={() => setSortKey(key)}
                        >
                          {label}
                          {sortKey === key && " ↓"}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr
                        key={`${r.platform}-${r.platform_post_id}`}
                        className="border-t border-slate-50 dark:border-slate-700/50"
                      >
                        <td className="px-5 py-3 max-w-md">
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${PLATFORM_BADGES[r.platform]}`}>
                              {r.platform === "instagram" ? "IG" : r.platform === "facebook" ? "FB" : "LI"}
                            </span>
                            {r.permalink ? (
                              <a
                                href={r.permalink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-slate-700 dark:text-slate-300 hover:text-brand-primary line-clamp-1"
                              >
                                {r.content_snippet.split("\n")[0] || "(no text)"}
                              </a>
                            ) : (
                              <span className="text-slate-700 dark:text-slate-300 line-clamp-1">
                                {r.content_snippet.split("\n")[0] || "(no text)"}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {r.posted_at ? new Date(r.posted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{num(r.reach || r.impressions)}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{num(r.likes)}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{num(r.comments)}</td>
                        <td className="px-3 py-3 font-medium text-slate-800 dark:text-slate-200">
                          {r.engagement_rate.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
