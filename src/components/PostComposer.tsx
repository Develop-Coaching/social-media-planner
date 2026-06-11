"use client";

import { useState, useRef } from "react";

const PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" },
] as const;

interface PickedFile {
  file: File;
  previewUrl: string;
  isVideo: boolean;
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDateTime(day?: Date): string {
  let d = day ? new Date(day) : new Date(Date.now() + 60 * 60 * 1000);
  if (day) d.setHours(9, 0, 0, 0);
  // Never default to the past (e.g. a clicked day earlier today, or 9am already gone)
  const earliest = new Date(Date.now() + 15 * 60 * 1000);
  if (d.getTime() < earliest.getTime()) d = earliest;
  return toLocalInput(d);
}

export default function PostComposer({
  companyId,
  day,
  onClose,
  onCreated,
}: {
  companyId: string;
  day?: Date;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [caption, setCaption] = useState("");
  const [platforms, setPlatforms] = useState<Set<string>>(new Set(["instagram", "facebook"]));
  const [dateTime, setDateTime] = useState(() => defaultDateTime(day));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const hasVideo = files.some((f) => f.isVideo);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked: PickedFile[] = Array.from(list).map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      isVideo: (file.type || "").startsWith("video"),
    }));
    setFiles((prev) => [...prev, ...picked]);
    setError(null);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const togglePlatform = (id: string) => {
    setPlatforms((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const contentType = hasVideo ? "reel" : files.length > 1 ? "carousel" : "post";

  const submit = async () => {
    if (files.length === 0) {
      setError("Add at least one image or video.");
      return;
    }
    if (platforms.size === 0) {
      setError("Pick at least one platform.");
      return;
    }
    if (hasVideo && files.length > 1) {
      setError("Schedule a video on its own (not mixed with images).");
      return;
    }
    if (new Date(dateTime).getTime() <= Date.now()) {
      setError("Pick a time in the future.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1. Upload each file
      const uploadPaths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading ${i + 1} of ${files.length}...`);
        const fd = new FormData();
        fd.append("file", files[i].file);
        fd.append("companyId", companyId);
        const res = await fetch("/api/uploads", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        uploadPaths.push(data.path);
      }

      // 2. Create the scheduled post
      setProgress("Scheduling...");
      const res = await fetch("/api/scheduled-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          contentType,
          caption,
          uploadPaths,
          platforms: Array.from(platforms),
          scheduledAt: new Date(dateTime).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to schedule");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200">Schedule a post</h3>
          <button onClick={onClose} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Media */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Media</label>
            {files.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-2">
                {files.map((f, i) => (
                  <div key={i} className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                    {f.isVideo ? (
                      <video src={f.previewUrl} className="w-full h-24 object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.previewUrl} alt="" className="w-full h-24 object-cover" />
                    )}
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              className="w-full py-3 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-600 text-sm text-slate-500 dark:text-slate-400 hover:border-brand-primary hover:text-brand-primary transition-colors"
            >
              + Upload image or video
            </button>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              {contentType === "carousel" ? "Multiple images = carousel." : contentType === "reel" ? "Video = reel / video post." : "One image = single post."}
            </p>
          </div>

          {/* Caption */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              placeholder="Write your caption..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
            />
          </div>

          {/* Platforms */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Post to</label>
            <div className="flex gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePlatform(p.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                    platforms.has(p.id) ? "border-brand-primary bg-brand-primary-light text-brand-primary" : "border-gray-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* When */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">When</label>
            <input
              type="datetime-local"
              value={dateTime}
              min={toLocalInput(new Date())}
              onChange={(e) => setDateTime(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 px-6 py-4 flex items-center justify-end gap-2 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-full border border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-300">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-5 py-2 text-sm font-medium rounded-full bg-brand-primary text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? progress || "Scheduling..." : "Schedule post"}
          </button>
        </div>
      </div>
    </div>
  );
}
