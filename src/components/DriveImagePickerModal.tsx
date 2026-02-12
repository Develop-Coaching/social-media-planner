"use client";

import { useState, useEffect, useCallback } from "react";
import { DriveFileInfo } from "@/types";

type DriveSource = "shared" | "mydrive";

interface FolderInfo {
  id: string;
  name: string;
}

interface Props {
  companyName: string;
  companyId: string;
  savedContentId: string | null;
  targetKey: string;
  onImport: (importedImages: Record<string, string>) => void;
  onClose: () => void;
}

export default function DriveImagePickerModal({ companyId, savedContentId, targetKey, onImport, onClose }: Props) {
  const [files, setFiles] = useState<DriveFileInfo[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<DriveSource>("shared");
  // Breadcrumb path for folder navigation
  const [path, setPath] = useState<FolderInfo[]>([]);

  const isSharedRoot = source === "shared" && path.length === 0;
  const currentFolderId = path.length > 0 ? path[path.length - 1].id : (source === "mydrive" ? "root" : null);

  const fetchContent = useCallback(async (folderId: string | null, currentSource: DriveSource, pageToken?: string) => {
    if (pageToken) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setFiles([]);
      setFolders([]);
      setNextPageToken(undefined);
    }
    setError(null);

    try {
      // Fetch folders and images in parallel
      const isSharedRootLevel = currentSource === "shared" && !folderId;

      // Fetch folders (only on first page)
      if (!pageToken) {
        let folderUrl: string;
        if (isSharedRootLevel) {
          folderUrl = "/api/drive/list?mode=folders&source=shared";
        } else {
          folderUrl = `/api/drive/list?mode=folders&folderId=${encodeURIComponent(folderId || "root")}`;
        }
        fetch(folderUrl)
          .then((r) => r.json())
          .then((data) => {
            if (data.folders) setFolders(data.folders);
          })
          .catch(() => {});
      }

      // Fetch images
      let imageUrl: string;
      if (isSharedRootLevel) {
        imageUrl = "/api/drive/list?source=shared";
      } else {
        imageUrl = `/api/drive/list?folderId=${encodeURIComponent(folderId || "root")}`;
      }
      if (pageToken) imageUrl += `&pageToken=${encodeURIComponent(pageToken)}`;

      const res = await fetch(imageUrl);
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
  }, []);

  useEffect(() => {
    fetchContent(currentFolderId, source);
  }, [currentFolderId, source, fetchContent]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function handleSourceChange(newSource: DriveSource) {
    setSource(newSource);
    setPath([]);
  }

  function navigateInto(folder: FolderInfo) {
    setPath((prev) => [...prev, folder]);
  }

  function navigateTo(index: number) {
    if (index < 0) {
      setPath([]);
    } else {
      setPath((prev) => prev.slice(0, index + 1));
    }
  }

  async function handleSelect(file: DriveFileInfo) {
    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/drive/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          savedContentId,
          files: [{ driveFileId: file.id, targetKey }],
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

  const hasContent = folders.length > 0 || files.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700 max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.71 3.5L1.15 15l2.16 3.75h4.73L4.46 12.5l2.17-3.75L7.71 3.5zm4.5 0L5.62 15l2.17 3.75h4.32l2.17-3.75L7.71 3.5h4.5zm4.5 0L10.12 15l2.17 3.75h4.32l6.56-11.5L20.71 3.5h-4z" />
            </svg>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Import Image from Google Drive</h3>
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

        {/* Source toggle */}
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-4 flex-wrap">
          <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden text-sm">
            <button
              onClick={() => handleSourceChange("shared")}
              className={`px-3 py-1.5 font-medium transition-colors ${
                source === "shared"
                  ? "bg-brand-primary text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              Shared with me
            </button>
            <button
              onClick={() => handleSourceChange("mydrive")}
              className={`px-3 py-1.5 font-medium transition-colors ${
                source === "mydrive"
                  ? "bg-brand-primary text-white"
                  : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              My Drive
            </button>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="px-6 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1 flex-wrap text-sm">
          <button
            onClick={() => navigateTo(-1)}
            className={`hover:text-brand-primary transition-colors ${
              path.length === 0
                ? "text-slate-800 dark:text-slate-200 font-medium"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {source === "shared" ? "Shared with me" : "My Drive"}
          </button>
          {path.map((p, idx) => (
            <span key={p.id} className="flex items-center gap-1">
              <span className="text-slate-400">/</span>
              <button
                onClick={() => navigateTo(idx)}
                className={`hover:text-brand-primary transition-colors ${
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm border border-red-200 dark:border-red-800">
              {error}
            </div>
          )}

          {importing && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <svg className="animate-spin h-8 w-8 text-brand-primary mx-auto mb-2" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <p className="text-sm text-slate-500">Importing image...</p>
              </div>
            </div>
          )}

          {!importing && loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="animate-spin h-8 w-8 text-brand-primary" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : !importing && !hasContent ? (
            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
              <svg className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">
                {isSharedRoot
                  ? "No files or folders shared with you."
                  : "No images or folders found here."}
              </p>
            </div>
          ) : !importing ? (
            <>
              {/* Folders */}
              {folders.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-2 uppercase tracking-wider">Folders</p>
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
                </div>
              )}

              {/* Images */}
              {files.length > 0 && (
                <>
                  {folders.length > 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-2 uppercase tracking-wider">Images</p>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {files.map((file) => (
                      <div
                        key={file.id}
                        className="rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-brand-primary overflow-hidden cursor-pointer transition-all group"
                        onClick={() => handleSelect(file)}
                      >
                        <div className="aspect-square bg-slate-100 dark:bg-slate-900 flex items-center justify-center overflow-hidden">
                          {file.thumbnailLink ? (
                            <img src={file.thumbnailLink} alt={file.name} className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-10 h-10 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          )}
                        </div>
                        <div className="p-2">
                          <p className="text-xs text-slate-700 dark:text-slate-300 font-medium truncate">{file.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {nextPageToken && (
                <div className="text-center mt-4">
                  <button
                    onClick={() => fetchContent(currentFolderId, source, nextPageToken)}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? "Loading..." : "Load more"}
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
