"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface ResearchedItem {
  type: "trend" | "format";
  title: string;
  summary: string;
  whyItWorks: string;
  formatBreakdown: { hook: string; structure: string; cta: string };
  exampleHook: string;
  sources: string[];
}

interface Draft {
  hook: string;
  body: string;
  cta: string;
  imageIdea?: string;
}

interface SavedIdea {
  id: string;
  niche: string;
  type: "trend" | "format";
  title: string;
  payload: ResearchedItem;
  draft: Draft | null;
  status: "new" | "drafted" | "used" | "archived";
  created_at: string;
}

interface Company {
  id: string;
  name: string;
}

const DEFAULT_NICHE =
  "UK construction business coaching — builders and contractors scaling their businesses";

function draftToText(draft: Draft): string {
  return [draft.hook, draft.body, draft.cta].filter(Boolean).join("\n\n");
}

export default function ResearchPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [niche, setNiche] = useState(DEFAULT_NICHE);
  const [researching, setResearching] = useState(false);
  const [items, setItems] = useState<ResearchedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft | "loading">>({});
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [savedIdeas, setSavedIdeas] = useState<SavedIdea[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((data) => {
        const list: Company[] = data.companies || [];
        setCompanies(list);
        if (list.length > 0) setCompanyId(list[0].id);
      })
      .catch(() => setError("Failed to load companies"));
  }, []);

  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/research/ideas?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => r.json())
      .then((data) => setSavedIdeas(data.ideas || []))
      .catch(() => {});
  }, [companyId]);

  const handleResearch = async () => {
    if (!companyId || !niche.trim()) return;
    setResearching(true);
    setError(null);
    setItems([]);
    setDrafts({});
    setSavedIds(new Set());
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, niche }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Research failed");
      setItems(data.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setResearching(false);
    }
  };

  const handleAdapt = async (index: number) => {
    const item = items[index];
    if (!item) return;
    setDrafts((prev) => ({ ...prev, [index]: "loading" }));
    try {
      const res = await fetch("/api/research/adapt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, niche, item }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to adapt");
      setDrafts((prev) => ({ ...prev, [index]: data.draft }));
    } catch (e) {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      setError(e instanceof Error ? e.message : "Failed to adapt");
    }
  };

  const handleSave = async (index: number) => {
    const item = items[index];
    const draft = drafts[index];
    if (!item) return;
    try {
      const res = await fetch("/api/research/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          niche,
          type: item.type,
          title: item.title,
          payload: item,
          draft: draft && draft !== "loading" ? draft : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setSavedIds((prev) => new Set(prev).add(index));
      setSavedIdeas((prev) => [data.idea, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const handleCopy = (index: number, draft: Draft) => {
    navigator.clipboard.writeText(draftToText(draft)).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  };

  const updateIdeaStatus = async (id: string, status: string) => {
    try {
      const res = await fetch("/api/research/ideas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, id, status }),
      });
      const data = await res.json();
      if (res.ok) {
        setSavedIdeas((prev) => prev.map((i) => (i.id === id ? data.idea : i)));
      }
    } catch {
      // non-fatal
    }
  };

  const trends = items.map((item, i) => ({ item, i })).filter(({ item }) => item.type === "trend");
  const formats = items.map((item, i) => ({ item, i })).filter(({ item }) => item.type === "format");
  const filteredIdeas =
    statusFilter === "all" ? savedIdeas : savedIdeas.filter((i) => i.status === statusFilter);

  const renderCard = ({ item, i }: { item: ResearchedItem; i: number }) => {
    const draft = drafts[i];
    return (
      <div
        key={i}
        className="rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-sm border border-slate-100 dark:border-slate-700"
      >
        <h4 className="font-semibold text-slate-800 dark:text-slate-200">{item.title}</h4>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{item.summary}</p>
        <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
          <span className="font-semibold">Why it works:</span> {item.whyItWorks}
        </p>
        {item.formatBreakdown && (
          <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 space-y-1">
            <p><span className="font-semibold">Hook:</span> {item.formatBreakdown.hook}</p>
            <p><span className="font-semibold">Structure:</span> {item.formatBreakdown.structure}</p>
            <p><span className="font-semibold">CTA:</span> {item.formatBreakdown.cta}</p>
          </div>
        )}
        {item.exampleHook && (
          <p className="mt-2 text-sm italic text-slate-700 dark:text-slate-300 border-l-2 border-brand-primary pl-3">
            &ldquo;{item.exampleHook}&rdquo;
          </p>
        )}
        {item.sources?.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500 truncate">
            Sources:{" "}
            {item.sources.slice(0, 3).map((s, j) => (
              <a key={j} href={s} target="_blank" rel="noreferrer" className="underline hover:text-brand-primary mr-2">
                [{j + 1}]
              </a>
            ))}
          </p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => handleAdapt(i)}
            disabled={draft === "loading"}
            className="px-3 py-1.5 text-xs font-medium rounded-full bg-brand-primary text-white hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {draft === "loading" ? "Writing..." : draft ? "Rewrite draft" : "Adapt to my niche"}
          </button>
          <button
            onClick={() => handleSave(i)}
            disabled={savedIds.has(i)}
            className="px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
          >
            {savedIds.has(i) ? "Saved ✓" : "Save idea"}
          </button>
        </div>

        {draft && draft !== "loading" && (
          <div className="mt-3 p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">
                Draft
              </h5>
              <button
                onClick={() => handleCopy(i, draft)}
                className="px-2.5 py-1 text-[11px] font-medium rounded-full border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
              >
                {copiedIndex === i ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{draftToText(draft)}</p>
            {draft.imageIdea && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold">Image idea:</span> {draft.imageIdea}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <header className="bg-brand-primary text-white">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <Link href="/" className="text-sm text-white/80 hover:text-white transition-colors">
            ← Back to dashboard
          </Link>
          <h1 className="text-2xl font-bold mt-1">Trend Research</h1>
          <p className="text-sm text-white/80">
            Find what&apos;s working in your niche, then adapt it to your voice
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Search controls */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-sm border border-slate-100 dark:border-slate-700 space-y-3">
          {companies.length > 1 && (
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <textarea
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            placeholder="Describe your niche..."
          />
          <button
            onClick={handleResearch}
            disabled={researching || !companyId || !niche.trim()}
            className="px-5 py-2 text-sm font-medium rounded-full bg-brand-primary text-white hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {researching ? "Researching the web... (this takes a minute)" : "Research trends"}
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-full px-4 py-2 border border-red-200 dark:border-red-800">
            {error}
          </p>
        )}

        {/* Results */}
        {trends.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-3">
              🔥 Trending topics
            </h2>
            <div className="grid md:grid-cols-2 gap-4">{trends.map(renderCard)}</div>
          </section>
        )}
        {formats.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-3">
              📐 Formats that are working
            </h2>
            <div className="grid md:grid-cols-2 gap-4">{formats.map(renderCard)}</div>
          </section>
        )}

        {/* Saved ideas */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Saved ideas</h2>
            <div className="flex items-center gap-2">
              {["all", "new", "drafted", "used", "archived"].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                    statusFilter === s
                      ? "border-brand-primary bg-brand-primary-light text-brand-primary"
                      : "border-gray-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {filteredIdeas.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No saved ideas yet.</p>
          ) : (
            <div className="space-y-3">
              {filteredIdeas.map((idea) => (
                <div
                  key={idea.id}
                  className="rounded-2xl bg-white dark:bg-slate-800 p-4 shadow-sm border border-slate-100 dark:border-slate-700"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 dark:text-slate-200">
                        <span className="text-xs mr-2">{idea.type === "trend" ? "🔥" : "📐"}</span>
                        {idea.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                        {idea.payload?.summary}
                      </p>
                      {idea.draft && (
                        <details className="mt-2">
                          <summary className="text-xs text-brand-primary cursor-pointer">View draft</summary>
                          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                            {draftToText(idea.draft)}
                          </p>
                        </details>
                      )}
                    </div>
                    <select
                      value={idea.status}
                      onChange={(e) => updateIdeaStatus(idea.id, e.target.value)}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 flex-shrink-0"
                    >
                      <option value="new">new</option>
                      <option value="drafted">drafted</option>
                      <option value="used">used</option>
                      <option value="archived">archived</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
