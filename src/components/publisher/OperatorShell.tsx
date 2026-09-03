"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LogoutButton from "@/components/LogoutButton";
import ThemeToggle from "@/components/ThemeToggle";
import type { OperatorQueueItem, OperatorQueueState } from "@/lib/publisher/operator";

interface Tenant { id: string; name: string; isAssigned: boolean }
interface Health {
  dispatchEnabled: boolean;
  configuredEpoch: number | null;
  ownership: { owner: "legacy" | "replacement"; epoch: number; cutoffAt: string | null; reconciled: boolean };
  platforms: Array<{ platform: string; configured: boolean; state: string }>;
}

const FILTERS: Array<{ id: "all" | OperatorQueueState; label: string }> = [
  { id: "all", label: "All" }, { id: "scheduled", label: "Scheduled" },
  { id: "frozen", label: "Frozen" }, { id: "planning_only", label: "Planning only" },
  { id: "published", label: "Published" }, { id: "verification_required", label: "Verify" },
  { id: "dead_letter", label: "Dead letter" },
];

const STATE_STYLE: Record<OperatorQueueState, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  frozen: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  planning_only: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  publishing: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  verification_required: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  dead_letter: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  historical: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  blocked: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

function label(value: string): string { return value.replaceAll("_", " "); }

function when(value: string | null): { local: string; utc: string } {
  if (!value) return { local: "No publish time", utc: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { local: "Invalid publish time", utc: "" };
  return {
    local: new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(date),
    utc: `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`,
  };
}

export default function OperatorShell() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [items, setItems] = useState<OperatorQueueItem[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/publisher/tenants", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load queue access");
        return body.tenants as Tenant[];
      })
      .then((next) => {
        if (!active) return;
        setTenants(next); setTenantId((current) => current || next[0]?.id || "");
        if (next.length === 0) setLoading(false);
      })
      .catch((reason) => { if (active) { setError(reason instanceof Error ? reason.message : "Unable to load queue access"); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestId = ++requestSequence.current;
    setLoading(true); setError(null); setItems([]); setHealth(null);
    try {
      const [queueResponse, healthResponse] = await Promise.all([
        fetch(`/api/publisher/queue?companyId=${encodeURIComponent(tenantId)}`, { cache: "no-store", signal: controller.signal }),
        fetch("/api/publisher/health", { cache: "no-store", signal: controller.signal }),
      ]);
      const queueBody = await queueResponse.json();
      const healthBody = await healthResponse.json();
      if (requestId !== requestSequence.current) return;
      if (!queueResponse.ok) throw new Error(queueBody.error || "Unable to load publisher queue");
      setItems(queueBody.items ?? []); setHealth(healthResponse.ok ? healthBody : null);
      if (!healthResponse.ok && healthResponse.status !== 403) setError("Publisher health is unavailable");
    } catch (reason) {
      if (requestId !== requestSequence.current) return;
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Unable to refresh publisher queue");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [tenantId]);

  const selectTenant = useCallback((nextTenantId: string) => {
    activeRequest.current?.abort();
    requestSequence.current += 1;
    setItems([]);
    setHealth(null);
    setError(null);
    setLoading(true);
    setTenantId(nextTenantId);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  const visible = useMemo(() => filter === "all" ? items : items.filter((item) => item.state === filter), [filter, items]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.slice(1).map(({ id }) => [id, items.filter((item) => item.state === id).length])), [items]);
  const currentTenant = tenants.find((tenant) => tenant.id === tenantId);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">Develop Coaching</p><h1 className="truncate text-xl font-bold sm:text-2xl">Publishing queue</h1></div>
          <div className="flex items-center gap-1"><ThemeToggle variant="page" /><LogoutButton variant="page" /></div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        <section className="mb-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div><label htmlFor="tenant" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Queue</label><select id="tenant" value={tenantId} onChange={(event) => selectTenant(event.target.value)} className="w-full max-w-md rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900">{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}{tenant.isAssigned ? " (assigned)" : ""}</option>)}</select></div>
          <button onClick={refresh} disabled={loading || !tenantId} className="self-end rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">{loading ? "Refreshing…" : "Refresh"}</button>
        </section>
        {health && <HealthPanel health={health} />}
        {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</div>}
        <nav aria-label="Queue filters" className="mb-5 flex gap-2 overflow-x-auto pb-1">{FILTERS.map(({ id, label: text }) => <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === id ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>{text}{id !== "all" ? ` ${counts[id] ?? 0}` : ` ${items.length}`}</button>)}</nav>
        {!loading && tenants.length === 0 ? <Empty title="No queue access" body="No publishing queue is assigned to this account. Ask an administrator to grant access." /> : !loading && visible.length === 0 ? <Empty title={currentTenant ? `Nothing in ${currentTenant.name}` : "Nothing here"} body="No items match this queue filter." /> : <section aria-live="polite" aria-busy={loading} className="space-y-3">{visible.map((item) => <QueueCard key={item.id} item={item} />)}</section>}
      </div>
    </main>
  );
}

function HealthPanel({ health }: { health: Health }) {
  const safeToRun = health.dispatchEnabled && health.ownership.owner === "replacement" && health.configuredEpoch === health.ownership.epoch;
  return <section aria-label="Publisher health" className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Publisher health</h2><p className="text-sm text-slate-500 dark:text-slate-400">{safeToRun ? "Replacement publisher is active." : health.ownership.owner === "legacy" ? "Legacy scheduler still owns the frozen migration queue." : "Dispatch is paused or its ownership epoch does not match."}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${safeToRun ? STATE_STYLE.published : STATE_STYLE.frozen}`}>{safeToRun ? "Active" : "Protected"}</span></div><div className="mt-3 flex flex-wrap gap-2">{health.platforms.map((platform) => <span key={platform.platform} className={`rounded-full px-2.5 py-1 text-xs font-medium ${platform.state === "ok" ? STATE_STYLE.published : platform.state === "unknown" ? STATE_STYLE.publishing : STATE_STYLE.dead_letter}`}>{platform.platform}: {platform.state}</span>)}</div></section>;
}

function QueueCard({ item }: { item: OperatorQueueItem }) {
  const time = when(item.scheduledAt);
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${STATE_STYLE[item.state]}`}>{label(item.state)}</span><span className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.contentType}</span>{item.legacySppId && <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300" title={item.legacySppId}>LEGACY-SPP {item.legacySppId.slice(0, 8)}</span>}</div><p className="text-sm leading-6 text-slate-800 dark:text-slate-200">{item.captionPreview}</p></div><div className="shrink-0 text-left sm:text-right"><p className="text-sm font-semibold">{time.local}</p><p className="text-xs text-slate-500">{time.utc}</p></div></div><div className="mt-4 grid gap-2 md:grid-cols-3">{item.deliveries.map((delivery) => <div key={delivery.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold capitalize">{delivery.platform}</span><span className="text-[11px] font-semibold uppercase text-slate-500">{label(delivery.state)}</span></div>{delivery.error && <p className="mt-2 text-xs leading-5 text-red-700 dark:text-red-300">{delivery.error}</p>}{delivery.liveUrl && <a href={delivery.liveUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-xs font-semibold text-indigo-600 underline underline-offset-2 dark:text-indigo-300">Open live post</a>}{delivery.attemptCount > 0 && <p className="mt-2 text-[11px] text-slate-500">Attempts: {delivery.attemptCount}/{delivery.maxAttempts}</p>}</div>)}</div><p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600 dark:bg-slate-950 dark:text-slate-300"><span className="font-semibold">Next action:</span> {item.nextAction}</p></article>;
}

function Empty({ title, body }: { title: string; body: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center dark:border-slate-700 dark:bg-slate-900"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">{body}</p></div>;
}
