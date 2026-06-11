"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// A generated content item that can be dragged onto the calendar to schedule it.
export interface DraftItem {
  itemId: string;
  type: string; // post | reel | carousel | article | quote
  label: string;
  caption: string;
  imageKeys: string[];
  videoUrl?: string;
}

interface ScheduledPost {
  id: string;
  item_id: string | null;
  content_type: string;
  caption: string;
  platforms: string[];
  scheduled_at: string;
  status: "queued" | "publishing" | "published" | "failed" | "cancelled";
  error: string | null;
}

interface Props {
  companyId: string;
  savedContentId?: string | null;
  drafts: DraftItem[];
  images: Record<string, string>;
  onCreateContent: () => void;
}

type ViewMode = "month" | "week";

const ALL_PLATFORMS = [
  { id: "instagram", label: "Instagram", short: "IG" },
  { id: "facebook", label: "Facebook", short: "FB" },
  { id: "linkedin", label: "LinkedIn", short: "LI" },
] as const;

const STATUS_DOT: Record<string, string> = {
  queued: "bg-blue-500",
  publishing: "bg-amber-500",
  published: "bg-green-500",
  failed: "bg-red-500",
  cancelled: "bg-slate-400",
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function defaultPlatforms(type: string): string[] {
  if (type === "article") return ["linkedin"];
  return ["instagram", "facebook"];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isoDate(d: Date): string {
  // local YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Monday-of-the-week for a date
function mondayOf(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function PlannerCalendar({ companyId, savedContentId, drafts, images, onCreateContent }: Props) {
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduledPost | null>(null);
  const [showTray, setShowTray] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/scheduled-posts?companyId=${encodeURIComponent(companyId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setPosts(data.posts || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  // Build the visible day cells
  const days = useMemo(() => {
    if (view === "week") {
      const start = mondayOf(cursor);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        return d;
      });
    }
    // Month: 6 weeks starting Monday on/before the 1st
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = mondayOf(first);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [view, cursor]);

  const postsByDay = useMemo(() => {
    const map: Record<string, ScheduledPost[]> = {};
    for (const p of posts) {
      const key = isoDate(new Date(p.scheduled_at));
      (map[key] ||= []).push(p);
    }
    return map;
  }, [posts]);

  const today = startOfDay(new Date());

  const navigate = (dir: -1 | 1) => {
    setCursor((c) => {
      const x = new Date(c);
      if (view === "week") x.setDate(x.getDate() + dir * 7);
      else x.setMonth(x.getMonth() + dir);
      return x;
    });
  };

  const periodLabel =
    view === "week"
      ? (() => {
          const m = mondayOf(cursor);
          const end = new Date(m);
          end.setDate(end.getDate() + 6);
          const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
          return `${fmt(m)} – ${fmt(end)}`;
        })()
      : cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const scheduleDraftOnDay = async (draft: DraftItem, day: Date) => {
    if (draft.type === "youtube") {
      setError("YouTube posts can't be auto-published yet.");
      return;
    }
    if (draft.type === "reel" && !draft.videoUrl) {
      setError("This reel needs a finished video before it can be scheduled.");
      return;
    }
    const at = new Date(day);
    at.setHours(9, 0, 0, 0); // default 9am
    try {
      const res = await fetch("/api/scheduled-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          savedContentId: savedContentId || undefined,
          itemId: draft.itemId,
          contentType: draft.type,
          caption: draft.caption,
          imageKeys: draft.imageKeys,
          videoUrl: draft.videoUrl || undefined,
          platforms: defaultPlatforms(draft.type),
          scheduledAt: at.toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to schedule");
      setError(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to schedule");
    }
  };

  const handleDrop = (e: React.DragEvent, day: Date) => {
    e.preventDefault();
    setDragOverKey(null);
    const itemId = e.dataTransfer.getData("text/plain");
    const draft = drafts.find((d) => d.itemId === itemId);
    if (draft) scheduleDraftOnDay(draft, day);
  };

  const cellMinH = view === "week" ? "min-h-[420px]" : "min-h-[96px]";

  return (
    <div className="grid lg:grid-cols-[1fr_240px] gap-4">
      {/* Calendar */}
      <div className="rounded-2xl bg-white dark:bg-slate-800 p-4 sm:p-5 shadow-sm border border-slate-100 dark:border-slate-700">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate(-1)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Previous">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h2 className="font-semibold text-slate-800 dark:text-slate-200 min-w-[140px] text-center">{periodLabel}</h2>
            <button onClick={() => navigate(1)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Next">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
            <button onClick={() => setCursor(startOfDay(new Date()))} className="ml-1 px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700">
              Today
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full border border-gray-200 dark:border-slate-600 overflow-hidden">
              {(["month", "week"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    view === v ? "bg-brand-primary text-white" : "text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <button
              onClick={onCreateContent}
              className="px-4 py-1.5 text-sm font-medium rounded-full bg-brand-primary text-white hover:opacity-90 transition-opacity"
            >
              + Create content
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_NAMES.map((d) => (
            <div key={d} className="text-center text-xs font-semibold text-slate-400 dark:text-slate-500 py-1">{d}</div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const key = isoDate(day);
            const dayPosts = postsByDay[key] || [];
            const inMonth = view === "week" || day.getMonth() === cursor.getMonth();
            const isToday = sameDay(day, today);
            return (
              <div
                key={key}
                onDragOver={(e) => { e.preventDefault(); setDragOverKey(key); }}
                onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
                onDrop={(e) => handleDrop(e, day)}
                className={`${cellMinH} rounded-lg border p-1.5 flex flex-col gap-1 transition-colors ${
                  dragOverKey === key
                    ? "border-brand-primary bg-brand-primary-light ring-1 ring-brand-primary/30"
                    : "border-slate-100 dark:border-slate-700"
                } ${inMonth ? "bg-white dark:bg-slate-800" : "bg-slate-50/60 dark:bg-slate-900/30"}`}
              >
                <div className={`text-xs font-medium flex items-center justify-center w-6 h-6 rounded-full ${
                  isToday ? "bg-brand-primary text-white" : inMonth ? "text-slate-600 dark:text-slate-300" : "text-slate-300 dark:text-slate-600"
                }`}>
                  {day.getDate()}
                </div>
                <div className="flex flex-col gap-1 overflow-y-auto">
                  {dayPosts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setEditing(p)}
                      className="text-left rounded-md bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 px-1.5 py-1 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[p.status]}`} />
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {new Date(p.scheduled_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-700 dark:text-slate-300 line-clamp-1 leading-tight">
                        {p.caption || p.content_type}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {loading && <p className="text-xs text-slate-400 mt-3 text-center">Loading scheduled posts...</p>}
      </div>

      {/* Drafts tray */}
      <div className="lg:sticky lg:top-4 self-start">
        <div className="rounded-2xl bg-white dark:bg-slate-800 p-4 shadow-sm border border-slate-100 dark:border-slate-700">
          <button
            onClick={() => setShowTray((s) => !s)}
            className="flex items-center justify-between w-full mb-2"
          >
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Unscheduled drafts</span>
            <span className="text-xs text-slate-400">{drafts.length}</span>
          </button>
          {showTray && (
            drafts.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  No drafts yet. Generate content, then drag it onto a day.
                </p>
                <button onClick={onCreateContent} className="px-3 py-1.5 text-xs font-medium rounded-full bg-brand-primary text-white hover:opacity-90">
                  + Create content
                </button>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-2">Drag a draft onto a day to schedule it.</p>
                <div className="space-y-2 max-h-[520px] overflow-y-auto">
                  {drafts.map((d) => {
                    const thumb = d.imageKeys.map((k) => images[k]).find(Boolean);
                    return (
                      <div
                        key={d.itemId}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", d.itemId)}
                        className="flex items-center gap-2 p-2 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 cursor-grab active:cursor-grabbing hover:border-brand-primary/50"
                      >
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                        ) : (
                          <span className="w-9 h-9 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[9px] font-bold text-slate-500 flex-shrink-0">
                            {d.label.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{d.label}</p>
                          <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-1">{d.caption || "(no caption)"}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )
          )}
        </div>
      </div>

      {editing && (
        <EditPostModal
          post={editing}
          companyId={companyId}
          onClose={() => setEditing(null)}
          onChanged={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ---------- Edit / remove a scheduled post ----------

function EditPostModal({
  post,
  companyId,
  onClose,
  onChanged,
}: {
  post: ScheduledPost;
  companyId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [platforms, setPlatforms] = useState<Set<string>>(new Set(post.platforms));
  const [dateTime, setDateTime] = useState(() => {
    const d = new Date(post.scheduled_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const editable = post.status === "queued" || post.status === "failed";

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/scheduled-posts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: post.id,
          companyId,
          platforms: Array.from(platforms),
          scheduledAt: new Date(dateTime).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await fetch(`/api/scheduled-posts?id=${post.id}&companyId=${encodeURIComponent(companyId)}`, { method: "DELETE" });
      onChanged();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200">Scheduled post</h3>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
            post.status === "published" ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
            : post.status === "failed" ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
            : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
          }`}>{post.status}</span>
        </div>

        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap mb-4 max-h-32 overflow-y-auto">{post.caption || `(${post.content_type})`}</p>

        {post.status === "failed" && post.error && (
          <p className="text-xs text-red-500 dark:text-red-400 mb-3">{post.error}</p>
        )}

        {editable ? (
          <>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Platforms</label>
            <div className="flex gap-2 mb-4">
              {ALL_PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatforms((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                    platforms.has(p.id) ? "border-brand-primary bg-brand-primary-light text-brand-primary" : "border-gray-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">When</label>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 mb-4"
            />

            {err && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{err}</p>}

            <div className="flex items-center justify-between">
              <button onClick={remove} disabled={busy} className="text-sm font-medium text-red-500 hover:text-red-600 disabled:opacity-40">
                Remove
              </button>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-full border border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">Cancel</button>
                <button onClick={save} disabled={busy || platforms.size === 0} className="px-4 py-2 text-sm font-medium rounded-full bg-brand-primary text-white hover:opacity-90 disabled:opacity-40">
                  {busy ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-full border border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
