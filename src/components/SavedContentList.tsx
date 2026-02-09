"use client";

import { useState, useMemo } from "react";
import { SavedContentItem } from "@/types";

interface Props {
  items: SavedContentItem[];
  currentSavedId: string | null;
  onLoad: (item: SavedContentItem) => void;
  onDelete: (id: string) => void;
  onBulkDelete?: (ids: string[]) => void;
}

export default function SavedContentList({ items, currentSavedId, onLoad, onDelete, onBulkDelete }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.theme.title.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredItems.forEach((item) => next.delete(item.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredItems.forEach((item) => next.add(item.id));
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

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    const idsToDelete = Array.from(selectedIds);
    if (onBulkDelete) {
      onBulkDelete(idsToDelete);
    } else {
      for (const id of idsToDelete) {
        onDelete(id);
      }
    }
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
    setBulkDeleting(false);
  }

  if (items.length === 0) return null;

  return (
    <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-3">
        <svg className="w-6 h-6 text-sky-600 dark:text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
        Saved Content ({items.length})
      </h2>

      {/* Search bar */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search saved content..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-shadow"
        />
      </div>

      {/* Bulk actions bar */}
      <div className="flex items-center justify-between mb-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleSelectAll}
            className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500 dark:bg-slate-900 dark:checked:bg-sky-600"
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

      {/* Confirmation dialog */}
      {showDeleteConfirm && (
        <div className="mb-4 p-4 rounded-xl border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20">
          <p className="text-sm text-red-800 dark:text-red-200 font-medium mb-3">
            Are you sure you want to delete {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.
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

      {/* Items list */}
      <div className="space-y-3">
        {filteredItems.length === 0 && searchQuery.trim() && (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
            No results matching &ldquo;{searchQuery}&rdquo;
          </p>
        )}
        {filteredItems.map((item) => (
          <div
            key={item.id}
            className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${
              currentSavedId === item.id
                ? "border-sky-500 bg-sky-50 dark:bg-sky-900/20"
                : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50"
            }`}
          >
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => toggleSelect(item.id)}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-sky-600 focus:ring-sky-500 dark:bg-slate-900 dark:checked:bg-sky-600 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800 dark:text-slate-200 truncate">{item.name}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {item.theme.title} &bull; Saved {new Date(item.savedAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={() => onLoad(item)}
                className="px-3 py-1.5 rounded-lg bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 text-sm font-medium hover:bg-sky-200 dark:hover:bg-sky-900 transition-colors"
              >
                Load
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
    </section>
  );
}
