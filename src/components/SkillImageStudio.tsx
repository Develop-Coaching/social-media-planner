"use client";

import { useState } from "react";
import { IMAGE_SKILLS, ImageSkill, PostProcessStep } from "@/lib/image-skills";

// ---------- Client-side watermark cleanup (ported from the skills' PIL code) ----------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function applyPostProcess(dataUrl: string, steps: PostProcessStep[]): Promise<string> {
  if (!steps.length) return dataUrl;
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  const w = canvas.width;
  const h = canvas.height;

  for (const step of steps) {
    if (step.kind === "whiteboard-mirror") {
      // Mirror the bottom-left wood strip over the bottom-right watermark region
      const sx0 = Math.floor(w * 0.02);
      const sy0 = Math.floor(h * 0.86);
      const sw = Math.floor(w * 0.18);
      const sh = h - sy0;
      const tx0 = Math.floor(w * 0.8);
      const tw = w - tx0;
      const strip = document.createElement("canvas");
      strip.width = sw;
      strip.height = sh;
      const stripCtx = strip.getContext("2d");
      if (!stripCtx) continue;
      // Flip horizontally while copying
      stripCtx.translate(sw, 0);
      stripCtx.scale(-1, 1);
      stripCtx.drawImage(canvas, sx0, sy0, sw, sh, 0, 0, sw, sh);
      ctx.drawImage(strip, 0, 0, sw, sh, tx0, sy0, tw, sh);
    } else if (step.kind === "corner-patch") {
      // Cover the bottom-right corner with a patch sampled to its left
      const pw = Math.floor(w * step.size);
      const ph = Math.floor(h * step.size);
      const sampleX = w - pw * step.sampleOffset;
      ctx.drawImage(canvas, sampleX, h - ph, pw, ph, w - pw, h - ph, pw, ph);
    } else if (step.kind === "black-border") {
      // Shrink and recenter on a black canvas for a uniform margin
      const innerW = Math.floor(w * (1 - 2 * step.margin));
      const innerH = Math.floor(h * (1 - 2 * step.margin));
      const shrunk = document.createElement("canvas");
      shrunk.width = w;
      shrunk.height = h;
      const sctx = shrunk.getContext("2d");
      if (!sctx) continue;
      sctx.fillStyle = "#000000";
      sctx.fillRect(0, 0, w, h);
      sctx.drawImage(canvas, 0, 0, w, h, Math.floor((w - innerW) / 2), Math.floor((h - innerH) / 2), innerW, innerH);
      ctx.drawImage(shrunk, 0, 0);
    }
  }

  return canvas.toDataURL("image/png");
}

// ---------- Component ----------

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function SkillImageStudio() {
  const [selected, setSelected] = useState<ImageSkill | null>(null);
  const [inputs, setInputs] = useState<Record<string, string | number>>({});
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectSkill = (skill: ImageSkill) => {
    setSelected(skill);
    setResults([]);
    setError(null);
    const defaults: Record<string, string | number> = {};
    for (const spec of skill.inputs) {
      if (spec.defaultValue !== undefined) defaults[spec.id] = spec.defaultValue;
    }
    setInputs(defaults);
  };

  const generateOne = async (
    skill: ImageSkill,
    imageIndex: number,
    slideCount: number,
    firstImageBase64?: string
  ): Promise<{ raw: string; processed: string }> => {
    const res = await fetch("/api/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: skill.id, inputs, imageIndex, slideCount, firstImageBase64 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Generation failed");
    const dataUrl = `data:${data.mimeType};base64,${data.imageBase64}`;
    const processed = await applyPostProcess(dataUrl, data.postProcess || []);
    return { raw: data.imageBase64 as string, processed };
  };

  const handleGenerate = async () => {
    if (!selected) return;
    setGenerating(true);
    setError(null);
    setResults([]);
    try {
      const slideCount = selected.multiImage
        ? Math.min(Math.max(Number(inputs.slides) || 2, 2), 10)
        : 1;
      const produced: string[] = [];
      let firstRaw: string | undefined;
      for (let i = 0; i < slideCount; i++) {
        setProgress(slideCount > 1 ? `Generating slide ${i + 1} of ${slideCount}...` : "Generating...");
        const { raw, processed } = await generateOne(selected, i, slideCount, firstRaw);
        if (i === 0) firstRaw = raw;
        produced.push(processed);
        setResults([...produced]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-1">Image Studio</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Pick a style and generate branded images
      </p>

      {/* Skill cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        {IMAGE_SKILLS.map((skill) => (
          <button
            key={skill.id}
            onClick={() => selectSkill(skill)}
            className={`text-left p-3 rounded-xl border transition-all ${
              selected?.id === skill.id
                ? "border-brand-primary bg-brand-primary-light ring-2 ring-brand-primary/20"
                : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-brand-primary/50 hover:shadow-sm"
            }`}
          >
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{skill.name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">{skill.description}</p>
          </button>
        ))}
      </div>

      {/* Inputs */}
      {selected && (
        <div className="space-y-3 mb-4">
          {selected.inputs.map((spec) => (
            <div key={spec.id}>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                {spec.label}
              </label>
              {spec.type === "textarea" ? (
                <textarea
                  value={String(inputs[spec.id] ?? "")}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [spec.id]: e.target.value }))}
                  placeholder={spec.placeholder}
                  rows={3}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                />
              ) : (
                <input
                  type={spec.type}
                  value={String(inputs[spec.id] ?? "")}
                  min={spec.min}
                  max={spec.max}
                  onChange={(e) =>
                    setInputs((prev) => ({
                      ...prev,
                      [spec.id]: spec.type === "number" ? Number(e.target.value) : e.target.value,
                    }))
                  }
                  placeholder={spec.placeholder}
                  className="w-full max-w-xs px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                />
              )}
              {spec.help && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{spec.help}</p>
              )}
            </div>
          ))}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-5 py-2 text-sm font-medium rounded-full bg-brand-primary text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? progress || "Generating..." : "Generate"}
          </button>
        </div>
      )}

      {error && (
        <p className="mb-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {results.map((src, i) => (
            <div key={i} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Generated ${i + 1}`} className="rounded-xl w-full shadow-md" />
              <button
                onClick={() => downloadDataUrl(src, `${selected?.id || "image"}-${i + 1}.png`)}
                className="absolute bottom-2 right-2 px-3 py-1.5 text-xs font-medium rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
