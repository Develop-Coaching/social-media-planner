"use client";

import { useState, useMemo } from "react";
import { SavedContentItem } from "@/types";

interface Props {
  items: SavedContentItem[];
  loading: boolean;
  companyName: string;
  onNewProject: () => void;
  onLoadProject: (item: SavedContentItem) => void;
  onDelete: (id: string) => void;
  onBulkDelete: (ids: string[]) => void;
  onComplete: (id: string) => void;
}

function daysRemaining(completedAt: string): number {
  const completedDate = new Date(completedAt).getTime();
  const expiryDate = completedDate + 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiryDate - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default function ProjectDashboard({
  items,
  loading,
  companyName,
  onNewProject,
  onLoadProject,
  onDelete,
  onBulkDelete,
  onComplete,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const activeItems = useMemo(() => items.filter((item) => item.status !== "completed"), [items]);
  const completedItems = useMemo(() => items.filter((item) => item.status === "completed"), [items]);

  const filteredActiveItems = useMemo(() => {
    if (!searchQuery.trim()) return activeItems;
    const q = searchQuery.toLowerCase();
    return activeItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.theme.title.toLowerCase().includes(q)
    );
  }, [activeItems, searchQuery]);

  const filteredCompletedItems = useMemo(() => {
    if (!searchQuery.trim()) return completedItems;
    const q = searchQuery.toLowerCase();
    return completedItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.theme.title.toLowerCase().includes(q)
    );
  }, [completedItems, searchQuery]);

  const allFilteredSelected = filteredActiveItems.length > 0 && filteredActiveItems.every((item) => selectedIds.has(item.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredActiveItems.forEach((item) => next.delete(item.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredActiveItems.forEach((item) => next.add(item.id));
        return next;
      });
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    onDelete(id);
    setDeletingId(null);
  }

  async function handleComplete(id: string) {
    setCompletingId(id);
    await onComplete(id);
    setCompletingId(null);
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    onBulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
    setBulkDeleting(false);
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-200">
            Projects
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {companyName} &bull; {activeItems.length} active project{activeItems.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={onNewProject}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-primary text-white font-medium shadow-md hover:shadow-lg hover:brightness-110 transition-all"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Project
        </button>
      </div>

      {/* Search bar */}
      {items.length > 0 && (
        <div className="relative mb-6">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-shadow"
          />
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 animate-pulse">
                <div className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="rounded-2xl bg-white dark:bg-slate-800 p-12 shadow-lg border border-slate-200 dark:border-slate-700 text-center">
          <svg className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">
            No projects yet
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            Create your first project to start generating content.
          </p>
          <button
            onClick={onNewProject}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-primary text-white font-medium shadow-md hover:shadow-lg hover:brightness-110 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Project
          </button>
        </div>
      )}

      {/* Active projects */}
      {!loading && items.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
          {/* Bulk actions bar */}
          {activeItems.length > 0 && (
            <div className="flex items-center justify-between mb-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-brand-primary focus:ring-brand-primary dark:bg-slate-900 dark:checked:bg-brand-primary"
                />
                <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">
                  Select all{searchQuery.trim() ? " filtered" : ""}
                </span>
              </label>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete selected ({selectedIds.size})
                </button>
              )}
            </div>
          )}

          {/* Confirmation dialog */}
          {showDeleteConfirm && (
            <div className="mb-4 p-4 rounded-xl border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20">
              <p className="text-sm text-red-800 dark:text-red-200 font-medium mb-3">
                Are you sure you want to delete {selectedIds.size} project{selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {bulkDeleting ? "Deleting..." : "Yes, delete"}
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 rounded-lg bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Active items list */}
          <div className="space-y-3">
            {filteredActiveItems.length === 0 && activeItems.length === 0 && completedItems.length > 0 && !searchQuery.trim() && (
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                All projects have been completed
              </p>
            )}
            {filteredActiveItems.length === 0 && searchQuery.trim() && (
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                No projects matching &ldquo;{searchQuery}&rdquo;
              </p>
            )}
            {filteredActiveItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 hover:border-brand-primary/50 transition-all group"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-brand-primary focus:ring-brand-primary dark:bg-slate-900 dark:checked:bg-brand-primary flex-shrink-0"
                />
                <button
                  onClick={() => onLoadProject(item)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="font-medium text-slate-800 dark:text-slate-200 truncate group-hover:text-brand-primary transition-colors">
                    {item.name}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {item.theme.title} &bull; Saved {new Date(item.savedAt).toLocaleDateString()}
                  </p>
                </button>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => onLoadProject(item)}
                    className="px-3 py-1.5 rounded-lg bg-brand-primary-light text-brand-primary text-sm font-medium hover:bg-brand-primary-hover transition-colors"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => handleComplete(item.id)}
                    disabled={completingId === item.id}
                    className="px-3 py-1.5 rounded-lg bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 text-sm font-medium hover:bg-green-200 dark:hover:bg-green-900 disabled:opacity-50 transition-colors"
                  >
                    {completingId === item.id ? "..." : "Done"}
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={deletingId === item.id}
                    className="px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900 disabled:opacity-50 transition-colors"
                  >
                    {deletingId === item.id ? "..." : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Completed section */}
          {completedItems.length > 0 && (
            <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <svg className={`w-4 h-4 transition-transform ${showCompleted ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Completed ({completedItems.length})
              </button>
              {showCompleted && (
                <div className="mt-3 space-y-3">
                  {(searchQuery.trim() ? filteredCompletedItems : completedItems).length === 0 && searchQuery.trim() && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-2">
                      No completed projects matching &ldquo;{searchQuery}&rdquo;
                    </p>
                  )}
                  {(searchQuery.trim() ? filteredCompletedItems : completedItems).map((item) => {
                    const days = item.completedAt ? daysRemaining(item.completedAt) : 30;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-4 rounded-xl border-2 border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-900/10 opacity-80"
                      >
                        <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-600 dark:text-slate-400 truncate">{item.name}</p>
                          <p className="text-sm text-slate-400 dark:text-slate-500">
                            {item.theme.title} &bull; Deletes in {days} day{days !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <button
                            onClick={() => onLoadProject(item)}
                            className="px-3 py-1.5 rounded-lg bg-brand-primary-light text-brand-primary text-sm font-medium hover:bg-brand-primary-hover transition-colors"
                          >
                            Open
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            disabled={deletingId === item.id}
                            className="px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900 disabled:opacity-50 transition-colors"
                          >
                            {deletingId === item.id ? "..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
