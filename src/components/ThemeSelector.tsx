"use client";

import { useState } from "react";
import { Theme } from "@/types";
import { useToast } from "@/components/ToastProvider";
import { ElapsedTimer } from "@/components/Skeleton";

interface Props {
  companyId: string;
  selectedTheme: Theme | null;
  onSelectTheme: (theme: Theme) => void;
}

export default function ThemeSelector({ companyId, selectedTheme, onSelectTheme }: Props) {
  const { toast } = useToast();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(false);
  const [useCustom, setUseCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [docText, setDocText] = useState("");
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState("");

  async function handleGetThemes() {
    setLoading(true);
    setThemes([]);
    try {
      const res = await fetch("/api/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (res.ok && data.themes?.length) setThemes(data.themes);
      else if (!res.ok) toast(data.error || "Failed to load themes", "error");
      else if (res.ok && !data.themes?.length) toast("No themes generated - try again", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleFetchDoc() {
    if (!docUrl.trim()) return;
    setDocLoading(true);
    setDocError("");
    try {
      const res = await fetch("/api/fetch-gdoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: docUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDocError(data.error || "Failed to fetch document");
        setDocText("");
      } else {
        setDocText(data.text);
        toast("Document attached", "success");
      }
    } catch {
      setDocError("Failed to fetch document. Make sure it's set to 'Anyone with the link can view'.");
    } finally {
      setDocLoading(false);
    }
  }

  function handleUseCustomTheme() {
    if (!customTitle.trim()) return;
    const customTheme: Theme = {
      id: `custom-${Date.now()}`,
      title: customTitle.trim(),
      description: customDescription.trim() || customTitle.trim(),
      referenceDoc: docText || undefined,
    };
    onSelectTheme(customTheme);
  }

  return (
    <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm border border-slate-100 dark:border-slate-700">
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-3">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-primary-light text-brand-primary text-sm font-bold">2</span>
        Content themes
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 ml-11">
        Generate theme ideas from your memory, or write your own custom theme.
      </p>
      <div className="ml-11">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setUseCustom(false)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              !useCustom
                ? "bg-brand-primary text-white shadow-sm"
                : "bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
            }`}
          >
            Generate Ideas
          </button>
          <button
            onClick={() => setUseCustom(true)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
              useCustom
                ? "bg-brand-primary text-white shadow-sm"
                : "bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
            }`}
          >
            Write Your Own
          </button>
        </div>

        {useCustom ? (
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Theme title (e.g. Overcoming Self-Doubt)"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-shadow"
            />
            <textarea
              placeholder="Describe the theme and what kind of content it should inspire..."
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              rows={3}
              className="w-full rounded-2xl border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 resize-y focus:ring-2 focus:ring-brand-primary focus:outline-none transition-shadow"
            />
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 p-4">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                Attach a reference document <span className="text-slate-400 dark:text-slate-500 font-normal">(optional)</span>
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
                Paste a Google Doc URL — its content will be used as extra context for this theme only.
                The document must be set to &ldquo;Anyone with the link can view&rdquo;.
              </p>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://docs.google.com/document/d/..."
                  value={docUrl}
                  onChange={(e) => { setDocUrl(e.target.value); setDocError(""); }}
                  className="flex-1 rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-shadow"
                />
                <button
                  type="button"
                  onClick={handleFetchDoc}
                  disabled={!docUrl.trim() || docLoading}
                  className="px-4 py-2.5 rounded-full bg-slate-100 dark:bg-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {docLoading ? "Fetching..." : "Attach"}
                </button>
              </div>
              {docError && (
                <p className="text-sm text-red-500 mt-2">{docError}</p>
              )}
              {docText && (
                <div className="mt-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm text-green-600 dark:text-green-400 font-medium">Document attached</span>
                  <span className="text-xs text-slate-400">({docText.length.toLocaleString()} chars)</span>
                  <button
                    type="button"
                    onClick={() => { setDocText(""); setDocUrl(""); }}
                    className="text-xs text-slate-400 hover:text-red-500 transition-colors ml-auto"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleUseCustomTheme}
              disabled={!customTitle.trim()}
              className="rounded-full bg-brand-primary text-white px-6 py-3 font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
            >
              Use This Theme
            </button>
            {selectedTheme?.id.startsWith("custom-") && (
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                Using custom theme: {selectedTheme.title}
              </p>
            )}
          </div>
        ) : (
          <>
            <button
              onClick={handleGetThemes}
              disabled={loading}
              className="rounded-full bg-brand-primary text-white px-6 py-3 font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                  Generating themes...
                </span>
              ) : "Get theme ideas"}
            </button>
            {loading && <ElapsedTimer className="ml-3" />}
            {themes.length > 0 && (
              <div className="mt-5 grid gap-3">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onSelectTheme(t)}
                    className={`text-left rounded-full border-2 p-4 transition-all ${
                      selectedTheme?.id === t.id
                        ? "border-brand-primary bg-brand-primary-light shadow-sm"
                        : "border-slate-200 dark:border-slate-600 hover:border-brand-primary hover:shadow-sm"
                    }`}
                  >
                    <span className="font-semibold text-slate-900 dark:text-white">{t.title}</span>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.description}</p>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
