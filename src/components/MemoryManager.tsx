"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MemoryFile } from "@/types";

interface Props {
  companyId: string;
}

export default function MemoryManager({ companyId }: Props) {
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadFiles();
  }, [companyId]);

  async function loadFiles() {
    try {
      const res = await fetch(`/api/memory?companyId=${companyId}`);
      const data = await res.json();
      if (res.ok && data.files) {
        setFiles(data.files);
      }
    } catch {
      // ignore
    }
  }

  async function handleSave() {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, name: name.trim(), content: content.trim() }),
      });
      if (res.ok) {
        setSaved(true);
        setContent("");
        setName("");
        loadFiles();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/memory?id=${id}&companyId=${companyId}`, { method: "DELETE" });
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function handleFileUpload(fileList: FileList) {
    setUploadError(null);
    setUploadProgress(null);
    setSaved(false);

    const MAX_SIZES = {
      text: 5 * 1024 * 1024,   // 5 MB
      pdf: 10 * 1024 * 1024,   // 10 MB
      image: 5 * 1024 * 1024,  // 5 MB
      word: 10 * 1024 * 1024,  // 10 MB
    };

    const fileArray = Array.from(fileList);
    let successCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      const isText = ["txt", "md"].includes(extension);
      const isPdf = extension === "pdf";
      const isImage = ["jpg", "jpeg", "png"].includes(extension);
      const isWord = ["doc", "docx"].includes(extension);

      let fileType: "text" | "pdf" | "image" | "word";
      let maxSize: number;

      if (isText) { fileType = "text"; maxSize = MAX_SIZES.text; }
      else if (isPdf) { fileType = "pdf"; maxSize = MAX_SIZES.pdf; }
      else if (isImage) { fileType = "image"; maxSize = MAX_SIZES.image; }
      else if (isWord) { fileType = "word"; maxSize = MAX_SIZES.word; }
      else { errors.push(`${file.name}: Unsupported file type`); continue; }

      if (file.size > maxSize) {
        errors.push(`${file.name}: Too large (max ${maxSize / (1024 * 1024)} MB)`);
        continue;
      }

      const fileName = file.name.replace(/\.[^.]+$/, "");

      if (fileType === "text") {
        if (fileArray.length === 1) {
          setName(fileName);
          const text = await file.text();
          setContent(text);
          successCount++;
        } else {
          setUploadProgress(`Processing ${i + 1}/${fileArray.length}: ${file.name}...`);
          try {
            const text = await file.text();
            const res = await fetch("/api/memory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ companyId, name: fileName, content: text }),
            });
            if (res.ok) successCount++;
            else {
              const data = await res.json();
              errors.push(`${file.name}: ${data.error || "Failed"}`);
            }
          } catch {
            errors.push(`${file.name}: Upload failed`);
          }
        }
      } else {
        const typeLabel = fileType === "pdf" ? "PDF" : fileType === "word" ? "Word doc" : "image";
        setUploadProgress(`Processing ${fileArray.length > 1 ? `${i + 1}/${fileArray.length}: ` : ""}${typeLabel}...`);

        try {
          // Step 1: Get a signed upload URL from the server
          const urlRes = await fetch("/api/memory/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: file.name }),
          });
          if (!urlRes.ok) {
            const urlData = await urlRes.json().catch(() => ({}));
            errors.push(`${file.name}: ${urlData.error || "Failed to get upload URL"}`);
            continue;
          }
          const { signedUrl, storagePath } = await urlRes.json();

          // Step 2: Upload file directly to Supabase Storage (bypasses Vercel body limit)
          const uploadRes = await fetch(signedUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!uploadRes.ok) {
            errors.push(`${file.name}: Failed to upload file to storage`);
            continue;
          }

          // Step 3: Tell the server to process the uploaded file
          const res = await fetch("/api/memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, name: fileName, storagePath, fileType, mimeType: file.type }),
          });

          if (res.ok) {
            successCount++;
          } else {
            let errorMsg = `HTTP ${res.status}`;
            try {
              const data = await res.json();
              errorMsg = data.error || errorMsg;
            } catch {
              if (res.status === 504) errorMsg = "Server timed out processing file";
            }
            errors.push(`${file.name}: ${errorMsg}`);
          }
        } catch (err) {
          errors.push(`${file.name}: ${err instanceof Error ? err.message : "Upload failed"}`);
        }
      }
    }

    setUploadProgress(null);

    if (successCount > 0) {
      loadFiles();
      if (fileArray.length > 1) {
        setSaved(true);
        setContent("");
        setName("");
      } else if (fileArray.length === 1 && !["txt", "md"].includes(fileArray[0].name.split(".").pop()?.toLowerCase() || "")) {
        setSaved(true);
        setContent("");
        setName("");
      }
    }

    if (errors.length > 0) {
      setUploadError(errors.join("\n"));
    }
  }

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      await handleFileUpload(droppedFiles);
    }
  }, [companyId]);

  return (
    <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-3">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400 text-sm font-bold">1</span>
        Add to memory
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 ml-11">
        Paste or type context, or upload files (.txt, .md, .pdf, .doc, .docx, .jpg, .png). Documents and images will be processed to extract text.
      </p>

      <div className="ml-11">
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative mb-3 rounded-xl border-2 border-dashed p-6 text-center transition-all ${
            isDragOver
              ? "border-sky-500 bg-sky-50 dark:bg-sky-900/20"
              : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/30 hover:border-slate-400 dark:hover:border-slate-500"
          }`}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-sky-50/90 dark:bg-sky-900/80">
              <div className="flex flex-col items-center gap-2">
                <svg className="w-10 h-10 text-sky-500 dark:text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-lg font-semibold text-sky-600 dark:text-sky-300">Drop files here</p>
              </div>
            </div>
          )}
          <svg className="mx-auto w-8 h-8 text-slate-400 dark:text-slate-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
            Drag & drop files here, or{" "}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-sky-600 dark:text-sky-400 font-medium hover:underline"
            >
              browse
            </button>
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            .txt, .md, .pdf, .doc, .docx, .jpg, .png
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.pdf,.doc,.docx,.jpg,.jpeg,.png,text/plain,text/markdown,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files;
              if (!f || f.length === 0) return;
              await handleFileUpload(f);
              e.target.value = "";
            }}
          />
        </div>
        {uploadProgress && (
          <p className="text-sm text-sky-600 dark:text-sky-400 mt-2 flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {uploadProgress}
          </p>
        )}
        {uploadError && (
          <p className="text-sm text-red-600 dark:text-red-400 mt-2 whitespace-pre-wrap">{uploadError}</p>
        )}
        <input
          type="text"
          placeholder="Name (e.g. Brand guidelines)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 mb-3 focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-shadow"
        />
        <textarea
          placeholder="Paste your context here..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 resize-y focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-shadow"
        />
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !content.trim()}
          className="mt-3 rounded-xl bg-sky-600 text-white px-6 py-3 font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
        >
          {saving ? "Saving..." : "Save to memory"}
        </button>
        {saved && (
          <span className="ml-3 text-sm text-green-600 dark:text-green-400 font-medium">Saved!</span>
        )}

        {files.length > 0 && (
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
              Files in memory ({files.length})
            </h3>
            <div className="space-y-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{file.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Added {new Date(file.addedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(file.id)}
                    disabled={deletingId === file.id}
                    className="ml-3 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 font-medium"
                  >
                    {deletingId === file.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
