"use client";

import { useState } from "react";
import { Company } from "@/types";
import FontPicker from "@/components/FontPicker";

interface Props {
  onComplete: (company: Company) => void;
  onCancel: () => void;
}

const STEPS = ["Name", "Slack", "Brand", "Review"];

export default function CompanySetupWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Step 1: Name
  const [name, setName] = useState("");

  // Step 2: Slack
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [slackEditorWebhookUrl, setSlackEditorWebhookUrl] = useState("");
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackChannelId, setSlackChannelId] = useState("");
  const [showAdvancedSlack, setShowAdvancedSlack] = useState(false);

  // Step 3: Brand
  const [logo, setLogo] = useState("");
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [fontFamily, setFontFamily] = useState("");

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be under 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function addColor(color: string) {
    if (brandColors.length >= 6) return;
    setBrandColors((prev) => [...prev, color]);
  }

  function removeColor(index: number) {
    setBrandColors((prev) => prev.filter((_, i) => i !== index));
  }

  function reorderColors(fromIndex: number, toIndex: number) {
    setBrandColors((prev) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= prev.length || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  async function handleCreate() {
    setCreating(true);
    setError("");
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: Record<string, any> = { name: name.trim() };
      if (logo) payload.logo = logo;
      if (brandColors.length) payload.brandColors = brandColors;
      if (fontFamily.trim()) payload.fontFamily = fontFamily.trim();
      if (slackWebhookUrl.trim()) payload.slackWebhookUrl = slackWebhookUrl.trim();
      if (slackEditorWebhookUrl.trim()) payload.slackEditorWebhookUrl = slackEditorWebhookUrl.trim();
      if (slackBotToken.trim()) payload.slackBotToken = slackBotToken.trim();
      if (slackChannelId.trim()) payload.slackChannelId = slackChannelId.trim();

      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const company: Company = await res.json();
        onComplete(company);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create company");
      }
    } catch {
      setError("Failed to create company");
    } finally {
      setCreating(false);
    }
  }

  const canNext = step === 0 ? name.trim().length > 0 : true;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 pt-6 pb-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <button
                onClick={() => { if (i < step) setStep(i); }}
                disabled={i > step}
                className={`w-8 h-8 rounded-full text-sm font-semibold flex items-center justify-center transition-all ${
                  i === step
                    ? "bg-brand-primary text-white shadow-lg"
                    : i < step
                    ? "bg-brand-primary-light text-brand-primary cursor-pointer hover:bg-brand-primary/20"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500"
                }`}
              >
                {i < step ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </button>
              {i < STEPS.length - 1 && (
                <div className={`w-8 h-0.5 ${i < step ? "bg-brand-primary" : "bg-slate-200 dark:bg-slate-700"}`} />
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400 mb-4">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>

        <div className="px-6 pb-6">
          {/* Step 0: Company Name */}
          {step === 0 && (
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                What&apos;s the company name?
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                This is the company or brand you&apos;ll be creating content for.
              </p>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && canNext) setStep(1); }}
                placeholder="e.g. Acme Corp"
                autoFocus
                className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-shadow text-lg"
              />
            </div>
          )}

          {/* Step 1: Slack Configuration */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                Connect to Slack
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                Optional &mdash; you can set this up later in Brand Settings.
              </p>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Content Schedule Webhook URL
                  </label>
                  <input
                    type="url"
                    value={slackWebhookUrl}
                    onChange={(e) => setSlackWebhookUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/..."
                    className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-shadow"
                  />
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    Receives the weekly content schedule when you click &ldquo;Send to Slack&rdquo;.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Editor Webhook URL
                  </label>
                  <input
                    type="url"
                    value={slackEditorWebhookUrl}
                    onChange={(e) => setSlackEditorWebhookUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/..."
                    className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-shadow"
                  />
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    Receives reel scripts when you click &ldquo;Send to Editor&rdquo;.
                  </p>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvancedSlack(!showAdvancedSlack)}
                    className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                  >
                    <svg className={`w-3.5 h-3.5 transition-transform ${showAdvancedSlack ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Advanced: Image upload settings
                  </button>
                  {showAdvancedSlack && (
                    <div className="mt-3 space-y-4 pl-5 border-l-2 border-slate-200 dark:border-slate-700">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Bot Token
                        </label>
                        <input
                          type="text"
                          value={slackBotToken}
                          onChange={(e) => setSlackBotToken(e.target.value)}
                          placeholder="xoxb-..."
                          className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-shadow font-mono"
                        />
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                          Required for uploading images to Slack. Create a Slack app with <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">files:write</code> and <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">chat:write</code> scopes.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                          Channel ID
                        </label>
                        <input
                          type="text"
                          value={slackChannelId}
                          onChange={(e) => setSlackChannelId(e.target.value)}
                          placeholder="C01234ABCDE"
                          className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none transition-shadow font-mono"
                        />
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                          Right-click a channel in Slack &rarr; &ldquo;View channel details&rdquo; &rarr; copy the Channel ID at the bottom.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-lg bg-brand-primary-light border border-brand-primary p-3">
                  <p className="text-xs text-brand-primary">
                    <strong>How to create a Slack webhook:</strong> Go to{" "}
                    <span className="font-mono">api.slack.com/apps</span> &rarr; Create New App &rarr; Incoming Webhooks &rarr; Activate &rarr; Add New Webhook to Workspace &rarr; choose the channel &rarr; copy the URL.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Brand Identity */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                Brand Identity
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                Optional &mdash; add your logo and brand colors.
              </p>

              <div className="space-y-6">
                {/* Logo */}
                <div>
                  <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-3">Logo</h4>
                  {logo ? (
                    <div className="flex items-center gap-4 mb-3">
                      <img src={logo} alt="Logo preview" className="w-16 h-16 rounded-lg object-contain border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1" />
                      <button
                        onClick={() => setLogo("")}
                        className="text-sm text-red-500 hover:text-red-700 dark:hover:text-red-400 font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">No logo uploaded</p>
                  )}
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Upload logo
                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  </label>
                  <p className="text-xs text-slate-400 mt-1">Max 2MB, PNG or JPG</p>
                </div>

                {/* Brand Colors */}
                <div>
                  <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-3">Brand Colors</h4>
                  <div className="flex flex-wrap gap-3 mb-3">
                    {brandColors.map((color, i) => (
                      <div
                        key={i}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("brand-color-index", String(i))}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = parseInt(e.dataTransfer.getData("brand-color-index"), 10);
                          reorderColors(from, i);
                        }}
                        className="flex flex-col items-center gap-1 cursor-grab active:cursor-grabbing"
                      >
                        <button
                          onClick={() => removeColor(i)}
                          title={`${color} — click to remove, drag to reorder`}
                          className={`w-9 h-9 rounded-full border-2 transition-colors hover:scale-110 hover:border-red-400 dark:hover:border-red-500 ${
                            i === 0
                              ? "border-brand-primary ring-2 ring-brand-primary/30"
                              : "border-slate-300 dark:border-slate-600"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                        {i <= 1 && (
                          <span className={`text-[10px] font-medium ${
                            i === 0 ? "text-brand-primary" : "text-slate-400 dark:text-slate-500"
                          }`}>
                            {i === 0 ? "Main" : "Accent"}
                          </span>
                        )}
                      </div>
                    ))}
                    {brandColors.length < 6 && (
                      <div className="flex flex-col items-center gap-1">
                        <label className="w-9 h-9 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center cursor-pointer hover:border-brand-primary transition-colors">
                          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          <input
                            type="color"
                            className="hidden"
                            onChange={(e) => addColor(e.target.value)}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {brandColors.length}/6 colors. Drag to reorder, click to remove.
                  </p>
                </div>

                {/* Font Family */}
                <FontPicker value={fontFamily} onChange={setFontFamily} />
              </div>
            </div>
          )}

          {/* Step 3: Review & Create */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                Review & Create
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                Confirm your settings before creating the company.
              </p>

              <div className="space-y-4">
                {/* Company Name */}
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-4">
                  <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Company Name</h4>
                  <p className="text-slate-900 dark:text-white font-medium">{name}</p>
                </div>

                {/* Slack */}
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-4">
                  <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Slack Integration</h4>
                  {slackWebhookUrl || slackEditorWebhookUrl || slackBotToken ? (
                    <div className="space-y-1 text-sm">
                      {slackWebhookUrl && (
                        <p className="text-slate-700 dark:text-slate-300">
                          <span className="text-slate-500 dark:text-slate-400">Schedule:</span> {slackWebhookUrl.slice(0, 50)}...
                        </p>
                      )}
                      {slackEditorWebhookUrl && (
                        <p className="text-slate-700 dark:text-slate-300">
                          <span className="text-slate-500 dark:text-slate-400">Editor:</span> {slackEditorWebhookUrl.slice(0, 50)}...
                        </p>
                      )}
                      {slackBotToken && (
                        <p className="text-slate-700 dark:text-slate-300">
                          <span className="text-slate-500 dark:text-slate-400">Bot token:</span> {slackBotToken.slice(0, 12)}...
                        </p>
                      )}
                      {slackChannelId && (
                        <p className="text-slate-700 dark:text-slate-300">
                          <span className="text-slate-500 dark:text-slate-400">Channel:</span> {slackChannelId}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 dark:text-slate-500 italic">Not set &mdash; using system defaults</p>
                  )}
                </div>

                {/* Brand */}
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-4">
                  <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Brand Identity</h4>
                  <div className="flex items-center gap-4">
                    {logo ? (
                      <img src={logo} alt="Logo" className="w-10 h-10 rounded-lg object-contain border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5" />
                    ) : (
                      <span className="text-sm text-slate-400 dark:text-slate-500 italic">No logo</span>
                    )}
                    {brandColors.length > 0 ? (
                      <div className="flex gap-1.5">
                        {brandColors.map((c, i) => (
                          <div key={i} className="w-6 h-6 rounded-full border border-slate-200 dark:border-slate-700" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400 dark:text-slate-500 italic">No colors</span>
                    )}
                  </div>
                  {fontFamily && (
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-2">
                      <span className="text-slate-500 dark:text-slate-400">Font:</span> {fontFamily}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8">
            <div>
              {step === 0 ? (
                <button
                  onClick={onCancel}
                  className="px-4 py-2.5 rounded-full text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => setStep(step - 1)}
                  className="px-4 py-2.5 rounded-full text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                >
                  Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {step > 0 && step < 3 && (
                <button
                  onClick={() => setStep(step + 1)}
                  className="px-4 py-2.5 rounded-full text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                >
                  Skip
                </button>
              )}
              {step < 3 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!canNext}
                  className="px-6 py-2.5 rounded-full bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="px-6 py-2.5 rounded-full bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
                >
                  {creating ? "Creating..." : "Create Company"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
