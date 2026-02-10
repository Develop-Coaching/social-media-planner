"use client";

import { useState, useEffect, useCallback } from "react";
import { DriveFileInfo, GeneratedContent } from "@/types";

type DriveSource = "mydrive" | "shared";

interface Props {
  companyName: string;
  companyId: string;
  content: GeneratedContent;
  images: Record<string, string>;
  onImport: (importedImages: Record<string, string>) => void;
  onClose: () => void;
}

function buildContentKeys(content: GeneratedContent): { key: string; label: string }[] {
  const keys: { key: string; label: string }[] = [];
  content.posts.forEach((p, i) => keys.push({ key: `post-${i}`, label: `Post ${i + 1}: ${p.title}` }));
  content.linkedinArticles.forEach((a, i) => keys.push({ key: `article-${i}`, label: `Article ${i + 1}: ${a.title}` }));
  content.carousels.forEach((c, i) => {
    c.slides.forEach((_, j) => keys.push({ key: `carousel-${i}-slide-${j}`, label: `Carousel ${i + 1}, Slide ${j + 1}` }));
  });
  content.quotesForX.forEach((_, i) => keys.push({ key: `quote-${i}`, label: `Quote ${i + 1}` }));
  content.youtube.forEach((y, i) => keys.push({ key: `yt-${i}`, label: `YouTube ${i + 1}: ${y.title}` }));
  return keys;
}

export default function DriveImportModal({ companyName, companyId, content, images, onImport, onClose }: Props) {
  const [files, setFiles] = useState<DriveFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<DriveSource>("shared");
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // Selection: driveFileId → targetKey
  const [selections, setSelections] = useState<Record<string, string>>({});

  const contentKeys = buildContentKeys(content);

  const fetchFolders = useCallback(async () => {
    if (source === "shared") {
      setFolders([]);
      return;
    }
    try {
      const res = await fetch(`/api/drive/list?companyName=${encodeURIComponent(companyName)}&mode=folders`);
      const data = await res.json();
      if (res.ok && data.folders) {
        setFolders(data.folders);
      }
    } catch {
      // Ignore - folders are optional
    }
  }, [companyName, source]);

  const fetchFiles = useCallback(async (folder?: string | null, pageToken?: string, currentSource?: DriveSource) => {
    const src = currentSource ?? source;
    if (pageToken) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setFiles([]);
      setNextPageToken(undefined);
    }
    setError(null);

    try {
      let url: string;
      if (src === "shared") {
        url = `/api/drive/list?source=shared`;
      } else {
        url = `/api/drive/list?companyName=${encodeURIComponent(companyName)}`;
        if (folder) url += `&folder=${encodeURIComponent(folder)}`;
      }
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load Drive files");
        return;
      }

      if (pageToken) {
        setFiles((prev) => [...prev, ...(data.files || [])]);
      } else {
        setFiles(data.files || []);
      }
      setNextPageToken(data.nextPageToken);
    } catch {
      setError("Network error loading Drive files");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [companyName, source]);

  useEffect(() => {
    fetchFolders();
    fetchFiles(null, undefined, source);
  }, [fetchFolders, fetchFiles, source]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function handleSourceChange(newSource: DriveSource) {
    setSource(newSource);
    setSelectedFolder(null);
    setFolders([]);
    setSelections({});
  }

  function toggleSelection(fileId: string) {
    setSelections((prev) => {
      const next = { ...prev };
      if (next[fileId]) {
        delete next[fileId];
      } else {
        // Auto-assign to first content key that doesn't have an image
        const firstAvailable = contentKeys.find((k) => !images[k.key] && !Object.values(prev).includes(k.key));
        next[fileId] = firstAvailable?.key || contentKeys[0]?.key || "";
      }
      return next;
    });
  }

  function updateAssignment(fileId: string, targetKey: string) {
    setSelections((prev) => ({ ...prev, [fileId]: targetKey }));
  }

  async function handleImport() {
    const entries = Object.entries(selections).filter(([, targetKey]) => targetKey);
    if (entries.length === 0) return;

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/drive/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          files: entries.map(([driveFileId, targetKey]) => ({ driveFileId, targetKey })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import failed");
        return;
      }

      if (data.images && Object.keys(data.images).length > 0) {
        onImport(data.images);
      }
      onClose();
    } catch {
      setError("Network error during import");
    } finally {
      setImporting(false);
    }
  }

  function handleFolderChange(folderName: string | null) {
    setSelectedFolder(folderName);
    setSelections({});
    fetchFiles(folderName);
  }

  const selectedCount = Object.keys(selections).length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.71 3.5L1.15 15l2.16 3.75h4.73L4.46 12.5l2.17-3.75L7.71 3.5zm4.5 0L5.62 15l2.17 3.75h4.32l2.17-3.75L7.71 3.5h4.5zm4.5 0L10.12 15l2.17 3.75h4.32l6.56-11.5L20.71 3.5h-4z" />
            </svg>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Import from Google Drive</h3>
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

        {/* Source toggle + folder selector */}
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-4 flex-wrap">
          <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden text-sm">
            <button
              onClick={() => handleSourceChange("shared")}
              className={`px-3 py-1.5 font-medium transition-colors ${
                source === "shared"
                  ? "bg-sky-600 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              Shared with me
            </button>
            <button
              onClick={() => handleSourceChange("mydrive")}
              className={`px-3 py-1.5 font-medium transition-colors ${
                source === "mydrive"
                  ? "bg-sky-600 text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              My Drive
            </button>
          </div>
          {source === "mydrive" && folders.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600 dark:text-slate-400">Folder:</label>
              <select
                value={selectedFolder || ""}
                onChange={(e) => handleFolderChange(e.target.value || null)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100"
              >
                <option value="">{companyName} (root)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.name}>{f.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm border border-red-200 dark:border-red-800">
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
          ) : files.length === 0 ? (
            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
              <svg className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">No images found{source === "shared" ? " shared with you" : " in this folder"}.</p>
              <p className="text-xs mt-1">
                {source === "shared"
                  ? "Ask someone to share images with your Google account, or switch to My Drive."
                  : "Upload images to your Drive folder first, or try a different folder."}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {files.map((file) => {
                  const isSelected = !!selections[file.id];
                  return (
                    <div
                      key={file.id}
                      className={`rounded-xl border-2 overflow-hidden cursor-pointer transition-all ${
                        isSelected
                          ? "border-sky-500 dark:border-sky-400 ring-2 ring-sky-200 dark:ring-sky-800"
                          : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                      }`}
                      onClick={() => toggleSelection(file.id)}
                    >
                      {/* Thumbnail */}
                      <div className="aspect-square bg-slate-100 dark:bg-slate-900 flex items-center justify-center overflow-hidden">
                        {file.thumbnailLink ? (
                          <img
                            src={file.thumbnailLink}
                            alt={file.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <svg className="w-10 h-10 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                      </div>

                      {/* Info */}
                      <div className="p-2">
                        <p className="text-xs text-slate-700 dark:text-slate-300 font-medium truncate">{file.name}</p>
                        {isSelected && (
                          <select
                            value={selections[file.id] || ""}
                            onChange={(e) => {
                              e.stopPropagation();
                              updateAssignment(file.id, e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1.5 w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                          >
                            <option value="">-- Assign to --</option>
                            {contentKeys.map((k) => (
                              <option key={k.key} value={k.key}>{k.label}</option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Selection indicator */}
                      {isSelected && (
                        <div className="absolute top-2 right-2">
                          <div className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Load more */}
              {nextPageToken && (
                <div className="text-center mt-4">
                  <button
                    onClick={() => fetchFiles(selectedFolder, nextPageToken)}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                        Loading...
                      </>
                    ) : (
                      "Load more"
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {selectedCount} image{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={importing || selectedCount === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-white font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors text-sm"
            >
              {importing ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                  Importing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Import {selectedCount} image{selectedCount !== 1 ? "s" : ""}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
