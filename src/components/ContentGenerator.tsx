"use client";

import { useState } from "react";
import { ContentCounts, ToneStyle, CustomToneStyle, Theme, toneOptions } from "@/types";

interface Props {
  selectedTheme: Theme;
  counts: ContentCounts;
  onCountsChange: (counts: ContentCounts) => void;
  selectedTone: ToneStyle;
  onToneChange: (tone: ToneStyle) => void;
  onGenerate: () => void;
  loading: boolean;
  customTones: CustomToneStyle[];
  onAddCustomTone: (label: string, prompt: string) => void;
  onDeleteCustomTone: (id: string) => void;
}

export default function ContentGenerator({ selectedTheme, counts, onCountsChange, selectedTone, onToneChange, onGenerate, loading, customTones, onAddCustomTone, onDeleteCustomTone }: Props) {
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customTab, setCustomTab] = useState<"paste" | "gdoc">("paste");
  const [customName, setCustomName] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [gdocUrl, setGdocUrl] = useState("");
  const [gdocName, setGdocName] = useState("");
  const [importingGdoc, setImportingGdoc] = useState(false);

  function handleSaveCustomTone() {
    if (!customName.trim() || !customPrompt.trim()) return;
    onAddCustomTone(customName.trim(), customPrompt.trim());
    setCustomName("");
    setCustomPrompt("");
    setShowCustomForm(false);
  }

  async function handleImportGdoc() {
    if (!gdocUrl.trim() || !gdocName.trim()) return;
    setImportingGdoc(true);
    try {
      const res = await fetch("/api/fetch-gdoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: gdocUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import Google Doc");
        return;
      }
      onAddCustomTone(gdocName.trim(), data.text);
      setGdocUrl("");
      setGdocName("");
      setShowCustomForm(false);
    } catch {
      alert("Failed to import Google Doc");
    } finally {
      setImportingGdoc(false);
    }
  }

  return (
    <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-3">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-sm font-bold">3</span>
        How much content?
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 ml-11">
        Theme: <strong className="text-indigo-600 dark:text-indigo-400">{selectedTheme.title}</strong>
      </p>
      <div className="ml-11">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
          {(["posts", "reels", "linkedinArticles", "carousels", "quotesForX", "youtube"] as const).map((key) => (
            <label key={key} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {key === "linkedinArticles" ? "LinkedIn articles" : key === "quotesForX" ? "Quotes (X)" : key}
              </span>
              <input
                type="number"
                min={0}
                max={20}
                value={counts[key]}
                onChange={(e) => onCountsChange({ ...counts, [key]: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                className="rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
              />
            </label>
          ))}
        </div>

        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Tone & style</label>
          <div className="flex flex-wrap gap-2">
            {toneOptions.map((tone) => (
              <button
                key={tone.id}
                onClick={() => onToneChange(tone)}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                  selectedTone.id === tone.id
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-md"
                    : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500"
                }`}
                title={tone.description}
              >
                {tone.label}
              </button>
            ))}

            {customTones.map((tone) => (
              <button
                key={tone.id}
                onClick={() => onToneChange(tone)}
                className={`group relative px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                  selectedTone.id === tone.id
                    ? "bg-purple-600 text-white border-purple-600 shadow-md"
                    : "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-600 hover:border-purple-400 dark:hover:border-purple-500"
                }`}
                title={tone.description}
              >
                {tone.label}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteCustomTone(tone.id);
                  }}
                  className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none cursor-pointer hover:bg-red-600"
                >
                  x
                </span>
              </button>
            ))}

            <button
              onClick={() => setShowCustomForm(!showCustomForm)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-all border border-dashed ${
                showCustomForm
                  ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-400"
                  : "text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600 hover:border-purple-400 hover:text-purple-600 dark:hover:text-purple-400"
              }`}
            >
              + Custom
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">{selectedTone.description}</p>
        </div>

        {showCustomForm && (
          <div className="mb-5 rounded-xl border border-purple-200 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/20 p-4">
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setCustomTab("paste")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  customTab === "paste"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40"
                }`}
              >
                Type / paste
              </button>
              <button
                onClick={() => setCustomTab("gdoc")}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  customTab === "gdoc"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40"
                }`}
              >
                Google Doc
              </button>
            </div>

            {customTab === "paste" ? (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Tone name (e.g. Our Brand Voice)"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <textarea
                  placeholder="Describe the brand voice, style guide, or tone instructions..."
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y"
                />
                <button
                  onClick={handleSaveCustomTone}
                  disabled={!customName.trim() || !customPrompt.trim()}
                  className="rounded-xl bg-purple-600 text-white px-4 py-2 text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Save tone
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Tone name (e.g. Brand Style Guide)"
                  value={gdocName}
                  onChange={(e) => setGdocName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <input
                  type="url"
                  placeholder="https://docs.google.com/document/d/..."
                  value={gdocUrl}
                  onChange={(e) => setGdocUrl(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  The document must be set to &quot;Anyone with the link can view&quot;
                </p>
                <button
                  onClick={handleImportGdoc}
                  disabled={!gdocName.trim() || !gdocUrl.trim() || importingGdoc}
                  className="rounded-xl bg-purple-600 text-white px-4 py-2 text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {importingGdoc ? "Importing..." : "Import & save tone"}
                </button>
              </div>
            )}
          </div>
        )}

        <button
          onClick={onGenerate}
          disabled={loading}
          className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 font-medium hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
        >
          {loading ? "Generating content..." : "Generate scripts & captions"}
        </button>
      </div>
    </section>
  );
}
