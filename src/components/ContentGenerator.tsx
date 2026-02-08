"use client";

import { ContentCounts, ToneStyle, Theme, toneOptions } from "@/types";

interface Props {
  selectedTheme: Theme;
  counts: ContentCounts;
  onCountsChange: (counts: ContentCounts) => void;
  selectedTone: ToneStyle;
  onToneChange: (tone: ToneStyle) => void;
  onGenerate: () => void;
  loading: boolean;
}

export default function ContentGenerator({ selectedTheme, counts, onCountsChange, selectedTone, onToneChange, onGenerate, loading }: Props) {
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
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">{selectedTone.description}</p>
        </div>

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
