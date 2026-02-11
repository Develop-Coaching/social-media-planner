"use client";

import { useState, useEffect, useCallback } from "react";

interface FolderInfo {
  id: string;
  name: string;
}

interface Props {
  onSelect: (folderId: string, folderName: string) => void;
  onClose: () => void;
}

export default function DriveFolderPickerModal({ onSelect, onClose }: Props) {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Breadcrumb trail: [{id, name}, ...] — first entry is always root
  const [path, setPath] = useState<FolderInfo[]>([{ id: "root", name: "My Drive" }]);

  const currentFolderId = path[path.length - 1].id;
  const currentFolderName = path[path.length - 1].name;

  const fetchFolders = useCallback(async (folderId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/drive/list?mode=folders&folderId=${encodeURIComponent(folderId)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load folders");
        return;
      }
      setFolders(data.folders || []);
    } catch {
      setError("Network error loading folders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFolders(currentFolderId);
  }, [currentFolderId, fetchFolders]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function navigateInto(folder: FolderInfo) {
    setPath((prev) => [...prev, folder]);
  }

  function navigateTo(index: number) {
    setPath((prev) => prev.slice(0, index + 1));
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.71 3.5L1.15 15l2.16 3.75h4.73L4.46 12.5l2.17-3.75L7.71 3.5zm4.5 0L5.62 15l2.17 3.75h4.32l2.17-3.75L7.71 3.5h4.5zm4.5 0L10.12 15l2.17 3.75h4.32l6.56-11.5L20.71 3.5h-4z" />
            </svg>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Choose Drive Folder</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="px-6 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1 flex-wrap text-sm">
          {path.map((p, idx) => (
            <span key={p.id} className="flex items-center gap-1">
              {idx > 0 && <span className="text-slate-400">/</span>}
              <button
                onClick={() => navigateTo(idx)}
                className={`hover:text-sky-600 dark:hover:text-sky-400 transition-colors ${
                  idx === path.length - 1
                    ? "text-slate-800 dark:text-slate-200 font-medium"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {p.name}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {error && (
            <div className="mb-3 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm border border-red-200 dark:border-red-800">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-8 w-8 text-sky-600" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : folders.length === 0 ? (
            <div className="text-center py-8 text-slate-500 dark:text-slate-400">
              <svg className="w-10 h-10 mx-auto mb-2 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p className="text-sm">No subfolders here.</p>
              <p className="text-xs mt-1">You can save to this folder or go back.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => navigateInto(f)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left group"
                >
                  <svg className="w-5 h-5 text-amber-500 dark:text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                  </svg>
                  <span className="text-sm text-slate-700 dark:text-slate-300 font-medium truncate">{f.name}</span>
                  <svg className="w-4 h-4 text-slate-400 ml-auto flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mr-3">
            Saving to: <span className="font-medium text-slate-700 dark:text-slate-300">{currentFolderName}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => onSelect(currentFolderId, currentFolderName)}
              className="px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition-colors text-sm"
            >
              Save Here
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
