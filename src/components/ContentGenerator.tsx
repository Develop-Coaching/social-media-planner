"use client";

import { useMemo, useState } from "react";
import { ContentCounts, ToneStyle, CustomToneStyle, CustomContentPreset, LanguageOption, Theme, toneOptions, languageOptions } from "@/types";
import { useToast } from "@/components/ToastProvider";
import { ElapsedTimer } from "@/components/Skeleton";

type ContentPreset = {
  id: string;
  label: string;
  counts: ContentCounts;
};

const contentPresets: ContentPreset[] = [
  { id: "instagram-heavy", label: "Instagram Heavy", counts: { posts: 10, reels: 5, carousels: 3, quotesForX: 0, linkedinArticles: 0, youtube: 0 } },
  { id: "linkedin-focus", label: "LinkedIn Focus", counts: { posts: 5, reels: 0, carousels: 0, quotesForX: 3, linkedinArticles: 3, youtube: 1 } },
  { id: "full-suite", label: "Full Suite", counts: { posts: 5, reels: 3, carousels: 3, quotesForX: 2, linkedinArticles: 2, youtube: 1 } },
  { id: "video-first", label: "Video First", counts: { posts: 2, reels: 8, carousels: 5, quotesForX: 0, linkedinArticles: 0, youtube: 0 } },
  { id: "written-content", label: "Written Content", counts: { posts: 3, reels: 0, carousels: 0, quotesForX: 5, linkedinArticles: 3, youtube: 2 } },
];

function countsMatch(a: ContentCounts, b: ContentCounts): boolean {
  return (
    a.posts === b.posts &&
    a.reels === b.reels &&
    a.linkedinArticles === b.linkedinArticles &&
    a.carousels === b.carousels &&
    a.quotesForX === b.quotesForX &&
    a.youtube === b.youtube
  );
}

interface Props {
  selectedTheme: Theme;
  counts: ContentCounts;
  onCountsChange: (counts: ContentCounts) => void;
  selectedTone: ToneStyle;
  onToneChange: (tone: ToneStyle) => void;
  selectedLanguage: LanguageOption;
  onLanguageChange: (language: LanguageOption) => void;
  onGenerate: () => void;
  loading: boolean;
  customTones: CustomToneStyle[];
  onAddCustomTone: (label: string, prompt: string) => void;
  onDeleteCustomTone: (id: string) => void;
  customPresets: CustomContentPreset[];
  onAddCustomPreset: (label: string, counts: ContentCounts) => void;
  onDeleteCustomPreset: (id: string) => void;
}

export default function ContentGenerator({ selectedTheme, counts, onCountsChange, selectedTone, onToneChange, selectedLanguage, onLanguageChange, onGenerate, loading, customTones, onAddCustomTone, onDeleteCustomTone, customPresets, onAddCustomPreset, onDeleteCustomPreset }: Props) {
  const { toast } = useToast();
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customTab, setCustomTab] = useState<"paste" | "gdoc">("paste");
  const [customName, setCustomName] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [gdocUrl, setGdocUrl] = useState("");
  const [gdocName, setGdocName] = useState("");
  const [importingGdoc, setImportingGdoc] = useState(false);
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [presetName, setPresetName] = useState("");

  const allPresets = useMemo(() => [...contentPresets, ...customPresets.map((p) => ({ id: p.id, label: p.label, counts: p.counts }))], [customPresets]);

  const activePresetId = useMemo(() => {
    const match = allPresets.find((p) => countsMatch(p.counts, counts));
    return match?.id ?? null;
  }, [counts, allPresets]);

  function handleSavePreset() {
    if (!presetName.trim()) return;
    const total = Object.values(counts).reduce((s, v) => s + v, 0);
    if (total === 0) { toast("Set at least one content count first", "error"); return; }
    onAddCustomPreset(presetName.trim(), { ...counts });
    setPresetName("");
    setShowPresetForm(false);
  }

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
        toast(data.error || "Failed to import Google Doc", "error");
        return;
      }
      onAddCustomTone(gdocName.trim(), data.text);
      setGdocUrl("");
      setGdocName("");
      setShowCustomForm(false);
    } catch {
      toast("Failed to import Google Doc", "error");
    } finally {
      setImportingGdoc(false);
    }
  }

  return (
    <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm border border-slate-100 dark:border-slate-700">
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-3">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-primary-light text-brand-primary text-sm font-bold">3</span>
        How much content?
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 ml-11">
        Theme: <strong className="text-brand-primary">{selectedTheme.title}</strong>
      </p>
      <div className="ml-11">
        {/* Content template presets */}
        <div className="mb-4">
          <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Quick presets</span>
          <div className="flex flex-wrap gap-2">
            {contentPresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => onCountsChange({ ...preset.counts })}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                  activePresetId === preset.id
                    ? "bg-brand-primary text-white border-brand-primary shadow-md"
                    : "bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600 hover:border-brand-primary hover:text-brand-primary"
                }`}
              >
                {preset.label}
              </button>
            ))}

            {customPresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => onCountsChange({ ...preset.counts })}
                className={`group relative px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                  activePresetId === preset.id
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-md"
                    : "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-600 hover:border-indigo-400 dark:hover:border-indigo-500"
                }`}
                title={`${preset.label}: ${preset.counts.posts}P ${preset.counts.reels}R ${preset.counts.carousels}C ${preset.counts.quotesForX}Q ${preset.counts.linkedinArticles}A ${preset.counts.youtube}Y`}
              >
                {preset.label}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteCustomPreset(preset.id);
                  }}
                  className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none cursor-pointer hover:bg-red-600"
                >
                  x
                </span>
              </button>
            ))}

            <button
              onClick={() => setShowPresetForm(!showPresetForm)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border border-dashed ${
                showPresetForm
                  ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-400"
                  : "text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400"
              }`}
            >
              + Save preset
            </button>
          </div>
          {showPresetForm && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                placeholder="Preset name..."
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSavePreset(); }}
                className="rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none w-48"
                autoFocus
              />
              <button
                onClick={handleSavePreset}
                disabled={!presetName.trim()}
                className="rounded-full bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => { setShowPresetForm(false); setPresetName(""); }}
                className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

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
                className="rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-shadow"
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
                className={`px-3 py-2 rounded-full text-sm font-medium transition-all border ${
                  selectedTone.id === tone.id
                    ? "bg-brand-primary text-white border-brand-primary shadow-sm"
                    : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 hover:border-brand-primary"
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
                className={`group relative px-3 py-2 rounded-full text-sm font-medium transition-all border ${
                  selectedTone.id === tone.id
                    ? "bg-teal-600 text-white border-teal-600 shadow-sm"
                    : "bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-600 hover:border-teal-400 dark:hover:border-teal-500"
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
              className={`px-3 py-2 rounded-full text-sm font-medium transition-all border border-dashed ${
                showCustomForm
                  ? "bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 border-teal-400"
                  : "text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-600 hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-400"
              }`}
            >
              + Custom
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">{selectedTone.description}</p>
        </div>

        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Language</label>
          <div className="flex flex-wrap gap-2">
            {languageOptions.map((lang) => (
              <button
                key={lang.id}
                onClick={() => onLanguageChange(lang)}
                className={`px-3 py-2 rounded-full text-sm font-medium transition-all border ${
                  selectedLanguage.id === lang.id
                    ? "bg-brand-primary text-white border-brand-primary shadow-sm"
                    : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 hover:border-brand-primary"
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {showCustomForm && (
          <div className="mb-5 rounded-xl border border-teal-200 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-900/20 p-4">
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setCustomTab("paste")}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  customTab === "paste"
                    ? "bg-teal-600 text-white shadow-sm"
                    : "text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/40"
                }`}
              >
                Type / paste
              </button>
              <button
                onClick={() => setCustomTab("gdoc")}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  customTab === "gdoc"
                    ? "bg-teal-600 text-white shadow-sm"
                    : "text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/40"
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
                  className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
                <textarea
                  placeholder="Describe the brand voice, style guide, or tone instructions..."
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-teal-500 focus:outline-none resize-y"
                />
                <button
                  onClick={handleSaveCustomTone}
                  disabled={!customName.trim() || !customPrompt.trim()}
                  className="rounded-full bg-teal-600 text-white px-4 py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                  className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
                <input
                  type="url"
                  placeholder="https://docs.google.com/document/d/..."
                  value={gdocUrl}
                  onChange={(e) => setGdocUrl(e.target.value)}
                  className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-teal-500 focus:outline-none"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  The document must be set to &quot;Anyone with the link can view&quot;
                </p>
                <button
                  onClick={handleImportGdoc}
                  disabled={!gdocName.trim() || !gdocUrl.trim() || importingGdoc}
                  className="rounded-full bg-teal-600 text-white px-4 py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          className="rounded-full bg-brand-primary text-white px-6 py-3 font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-lg"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
              Generating content...
            </span>
          ) : "Generate scripts & captions"}
        </button>
        {loading && <ElapsedTimer className="ml-3" />}
      </div>
    </section>
  );
}
