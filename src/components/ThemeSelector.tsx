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

  function handleUseCustomTheme() {
    if (!customTitle.trim()) return;
    const customTheme: Theme = {
      id: `custom-${Date.now()}`,
      title: customTitle.trim(),
      description: customDescription.trim() || customTitle.trim(),
    };
    onSelectTheme(customTheme);
  }

  return (
    <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
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
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              !useCustom
                ? "bg-brand-primary text-white shadow-md"
                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}
          >
            Generate Ideas
          </button>
          <button
            onClick={() => setUseCustom(true)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              useCustom
                ? "bg-brand-primary text-white shadow-md"
                : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
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
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-shadow"
            />
            <textarea
              placeholder="Describe the theme and what kind of content it should inspire..."
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 resize-y focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-shadow"
            />
            <button
              onClick={handleUseCustomTheme}
              disabled={!customTitle.trim()}
              className="rounded-xl bg-brand-primary text-white px-6 py-3 font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
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
              className="rounded-xl bg-brand-primary text-white px-6 py-3 font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
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
                    className={`text-left rounded-xl border-2 p-4 transition-all ${
                      selectedTheme?.id === t.id
                        ? "border-brand-primary bg-brand-primary-light shadow-md"
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
