"use client";

import { useState, useEffect, useCallback } from "react";
import { DriveFileInfo } from "@/types";

type DriveSource = "mydrive" | "shared";

interface Props {
  companyName: string;
  onSelect: (video: { fileId: string; webViewLink: string; name: string }) => void;
  onClose: () => void;
}

export default function DriveVideoPickerModal({ companyName, onSelect, onClose }: Props) {
  const [files, setFiles] = useState<DriveFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<DriveSource>("shared");
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

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
      // Folders are optional
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
        url = `/api/drive/list?type=videos&source=shared`;
      } else {
        url = `/api/drive/list?companyName=${encodeURIComponent(companyName)}&type=videos`;
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
  }

  function handleFolderChange(folderName: string | null) {
    setSelectedFolder(folderName);
    fetchFiles(folderName);
  }

  function handleSelect(file: DriveFileInfo) {
    onSelect({
      fileId: file.id,
      webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      name: file.name,
    });
  }

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
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Link Video from Google Drive</h3>
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p className="text-sm">No videos found{source === "shared" ? " shared with you" : " in this folder"}.</p>
              <p className="text-xs mt-1">
                {source === "shared"
                  ? "Ask someone to share a video with your Google account, or switch to My Drive."
                  : "Upload videos to your Drive folder first, or try a different folder."}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-sky-400 dark:hover:border-sky-500 overflow-hidden cursor-pointer transition-all group"
                    onClick={() => handleSelect(file)}
                  >
                    {/* Thumbnail */}
                    <div className="aspect-video bg-slate-100 dark:bg-slate-900 flex items-center justify-center overflow-hidden relative">
                      {file.thumbnailLink ? (
                        <img
                          src={file.thumbnailLink}
                          alt={file.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <svg className="w-10 h-10 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                      {/* Play icon overlay */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                        <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                          <svg className="w-5 h-5 text-slate-800 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-2">
                      <p className="text-xs text-slate-700 dark:text-slate-300 font-medium truncate">{file.name}</p>
                      {file.size && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                          {(parseInt(file.size) / (1024 * 1024)).toFixed(1)} MB
                        </p>
                      )}
                    </div>
                  </div>
                ))}
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
        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
