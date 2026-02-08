"use client";

import { useState, useEffect } from "react";
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
      text: 5 * 1024 * 1024,
      pdf: 10 * 1024 * 1024,
      image: 5 * 1024 * 1024,
      word: 10 * 1024 * 1024,
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
          const buffer = await file.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
          );

          const res = await fetch("/api/memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId, name: fileName, fileData: base64, fileType, mimeType: file.type }),
          });

          const data = await res.json();
          if (res.ok) successCount++;
          else errors.push(`${file.name}: ${data.error || "Failed to process"}`);
        } catch {
          errors.push(`${file.name}: Upload failed`);
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

  return (
    <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-3">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-sm font-bold">1</span>
        Add to memory
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 ml-11">
        Paste or type context, or upload files (.txt, .md, .pdf, .doc, .docx, .jpg, .png). Documents and images will be processed to extract text.
      </p>

      <div className="ml-11">
        <label className="mb-3 block">
          <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">Upload file(s):</span>
          <input
            type="file"
            multiple
            accept=".txt,.md,.pdf,.doc,.docx,.jpg,.jpeg,.png,text/plain,text/markdown,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
            className="mt-2 block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-100 file:px-4 file:py-2 file:text-indigo-700 file:font-medium dark:file:bg-indigo-900/30 dark:file:text-indigo-300 file:cursor-pointer hover:file:bg-indigo-200 dark:hover:file:bg-indigo-900/50 transition-colors"
            onChange={async (e) => {
              const f = e.target.files;
              if (!f || f.length === 0) return;
              await handleFileUpload(f);
              e.target.value = "";
            }}
          />
        </label>
        {uploadProgress && (
          <p className="text-sm text-indigo-600 dark:text-indigo-400 mt-2 flex items-center gap-2">
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
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 mb-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
        />
        <textarea
          placeholder="Paste your context here..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 resize-y focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
        />
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !content.trim()}
          className="mt-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 font-medium hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
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
