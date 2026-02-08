"use client";

import { useState } from "react";
import { SavedContentItem } from "@/types";

interface Props {
  items: SavedContentItem[];
  currentSavedId: string | null;
  onLoad: (item: SavedContentItem) => void;
  onDelete: (id: string) => void;
}

export default function SavedContentList({ items, currentSavedId, onLoad, onDelete }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    onDelete(id);
    setDeletingId(null);
  }

  if (items.length === 0) return null;

  return (
    <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-3">
        <svg className="w-6 h-6 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
        Saved Content ({items.length})
      </h2>
      <div className="space-y-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
              currentSavedId === item.id
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
                : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50"
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800 dark:text-slate-200 truncate">{item.name}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {item.theme.title} &bull; Saved {new Date(item.savedAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={() => onLoad(item)}
                className="px-3 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-sm font-medium hover:bg-indigo-200 dark:hover:bg-indigo-900 transition-colors"
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
