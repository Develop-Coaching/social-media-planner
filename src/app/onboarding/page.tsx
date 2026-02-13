"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

const CONSTRUCTION_TYPES = [
  "General Contractor", "Electrician", "Plumber", "Roofer", "HVAC",
  "Landscaper", "Painter", "Flooring", "Concrete & Masonry",
  "Framing & Carpentry", "Demolition", "Excavation", "Fencing",
  "Siding & Gutters", "Solar & Renewable Energy", "Other",
];

const TEAM_SIZES = ["Just me", "2-5", "6-15", "16-50", "50+"];

const BRAND_VOICES = [
  "Professional", "Casual", "Playful", "Authoritative",
  "Inspirational", "Educational", "Bold", "Friendly",
];

const PLATFORMS = [
  "Instagram", "LinkedIn", "X/Twitter", "Facebook", "YouTube", "TikTok",
];

const FREQUENCIES = [
  "Daily", "Few times a week", "Weekly", "Bi-weekly", "Monthly",
];

const CONTENT_TYPES = [
  "Image posts", "Reels/Shorts", "Long articles", "Carousels",
  "Quote graphics", "YouTube videos",
];

const TOTAL_STEPS = 5;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1: Business Basics
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [customIndustry, setCustomIndustry] = useState("");
  const [targetAudience, setTargetAudience] = useState("");

  // Step 2: About Your Company
  const [teamSize, setTeamSize] = useState("");
  const [serviceArea, setServiceArea] = useState("");

  // Step 3: Brand Voice & Content
  const [brandVoice, setBrandVoice] = useState<string[]>([]);
  const [contentTopics, setContentTopics] = useState("");
  const [website, setWebsite] = useState("");

  // Step 4: Social Media
  const [socialPlatforms, setSocialPlatforms] = useState<string[]>([]);
  const [postingFrequency, setPostingFrequency] = useState("");
  const [contentTypes, setContentTypes] = useState<string[]>([]);

  // Step 5: Integrations & Finish
  const [uniqueValue, setUniqueValue] = useState("");
  const [slackFilmingEnabled, setSlackFilmingEnabled] = useState(false);
  const [slackFilmingWebhook, setSlackFilmingWebhook] = useState("");
  const [slackEditorEnabled, setSlackEditorEnabled] = useState(false);
  const [slackEditorWebhook, setSlackEditorWebhook] = useState("");
  const [slackPostReadyEnabled, setSlackPostReadyEnabled] = useState(false);
  const [slackPostReadyWebhook, setSlackPostReadyWebhook] = useState("");
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackChannelId, setSlackChannelId] = useState("");

  function toggleChip(value: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function canProceed(): boolean {
    if (step === 1) return !!businessName.trim();
    return true;
  }

  async function handleSubmit() {
    if (!businessName.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          industry: industry === "Other" ? customIndustry.trim() || "Other" : industry,
          targetAudience: targetAudience.trim(),
          teamSize,
          serviceArea: serviceArea.trim(),
          brandVoice,
          contentTopics: contentTopics.trim(),
          website: website.trim(),
          socialPlatforms,
          postingFrequency,
          contentTypes,
          uniqueValue: uniqueValue.trim(),
          slackWebhookUrl: slackFilmingEnabled ? slackFilmingWebhook.trim() : undefined,
          slackEditorWebhookUrl: slackEditorEnabled ? slackEditorWebhook.trim() : undefined,
          slackBotToken: slackPostReadyEnabled ? slackBotToken.trim() : undefined,
          slackChannelId: slackPostReadyEnabled ? slackChannelId.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        router.push("/");
        router.refresh();
      } else {
        setError(data.error || "Something went wrong");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const progress = (step / TOTAL_STEPS) * 100;

  const inputClass = "w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none";
  const textareaClass = "w-full rounded-2xl border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none resize-none";
  const labelClass = "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2";

  function chipClass(active: boolean) {
    return `px-4 py-2 rounded-full text-sm font-medium transition-all border ${
      active
        ? "bg-brand-primary text-white border-brand-primary"
        : "bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-brand-primary"
    }`;
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center px-6 py-12">
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="page" />
      </div>
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            Let&apos;s set up your brand
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Tell us about your business so we can create better content for you
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>Step {step} of {TOTAL_STEPS}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-primary rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-sm border border-slate-100 dark:border-slate-700">
          {/* Step 1: Business Basics */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className={labelClass}>
                  What&apos;s your business/brand name? <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Smith Construction"
                  autoFocus
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>
                  What type of construction work do you do?
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select type...</option>
                  {CONSTRUCTION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {industry === "Other" && (
                  <input
                    type="text"
                    value={customIndustry}
                    onChange={(e) => setCustomIndustry(e.target.value)}
                    placeholder="Enter your specialty"
                    className={`${inputClass} mt-3`}
                  />
                )}
              </div>

              <div>
                <label className={labelClass}>
                  Who is your target audience?
                </label>
                <textarea
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="Homeowners, commercial property managers, real estate developers..."
                  rows={3}
                  className={textareaClass}
                />
              </div>
            </div>
          )}

          {/* Step 2: About Your Company */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className={labelClass}>
                  How big is your team?
                </label>
                <div className="flex flex-wrap gap-2">
                  {TEAM_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setTeamSize(size)}
                      className={chipClass(teamSize === size)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  What area do you serve?
                </label>
                <input
                  type="text"
                  value={serviceArea}
                  onChange={(e) => setServiceArea(e.target.value)}
                  placeholder="e.g. Greater Austin, TX"
                  autoFocus
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {/* Step 3: Brand Voice & Content */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <label className={labelClass}>
                  What&apos;s your brand voice/personality?
                </label>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">Select all that apply</p>
                <div className="flex flex-wrap gap-2">
                  {BRAND_VOICES.map((voice) => (
                    <button
                      key={voice}
                      type="button"
                      onClick={() => toggleChip(voice, brandVoice, setBrandVoice)}
                      className={chipClass(brandVoice.includes(voice))}
                    >
                      {voice}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  What topics do you regularly create content about?
                </label>
                <textarea
                  value={contentTopics}
                  onChange={(e) => setContentTopics(e.target.value)}
                  placeholder="Project showcases, before/after transformations, tips & tricks..."
                  rows={3}
                  className={textareaClass}
                />
              </div>

              <div>
                <label className={labelClass}>
                  What&apos;s your website URL?
                </label>
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://yourwebsite.com (optional)"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {/* Step 4: Social Media */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <label className={labelClass}>
                  What social media platforms do you use?
                </label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => toggleChip(platform, socialPlatforms, setSocialPlatforms)}
                      className={chipClass(socialPlatforms.includes(platform))}
                    >
                      {platform}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  How often do you post content?
                </label>
                <select
                  value={postingFrequency}
                  onChange={(e) => setPostingFrequency(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select frequency...</option>
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>
                  What content types do you create most?
                </label>
                <div className="flex flex-wrap gap-2">
                  {CONTENT_TYPES.map((ct) => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => toggleChip(ct, contentTypes, setContentTypes)}
                      className={chipClass(contentTypes.includes(ct))}
                    >
                      {ct}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Integrations & Finish */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <label className={labelClass}>
                  What makes your brand unique? What sets you apart?
                </label>
                <textarea
                  value={uniqueValue}
                  onChange={(e) => setUniqueValue(e.target.value)}
                  placeholder="Your unique selling points, brand story, what makes you different..."
                  rows={4}
                  autoFocus
                  className={textareaClass}
                />
              </div>

              {/* Slack Integrations */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-5">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Slack Integrations</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Connect Slack to get notifications and send content to your team. You can set these up later in Brand Settings.</p>

                <div className="space-y-4">
                  {/* Filming Schedule */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Filming Schedule</span>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Get notified in Slack when filming needs to happen</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSlackFilmingEnabled(!slackFilmingEnabled)}
                        className={`relative w-11 h-6 rounded-full transition-colors ${slackFilmingEnabled ? "bg-brand-primary" : "bg-slate-300 dark:bg-slate-600"}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${slackFilmingEnabled ? "translate-x-5" : ""}`} />
                      </button>
                    </label>
                    {slackFilmingEnabled && (
                      <input
                        type="url"
                        value={slackFilmingWebhook}
                        onChange={(e) => setSlackFilmingWebhook(e.target.value)}
                        placeholder="https://hooks.slack.com/services/..."
                        className={`${inputClass} mt-3 text-sm`}
                      />
                    )}
                  </div>

                  {/* Editor */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Editor</span>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Send reel scripts to your editor via Slack</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSlackEditorEnabled(!slackEditorEnabled)}
                        className={`relative w-11 h-6 rounded-full transition-colors ${slackEditorEnabled ? "bg-brand-primary" : "bg-slate-300 dark:bg-slate-600"}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${slackEditorEnabled ? "translate-x-5" : ""}`} />
                      </button>
                    </label>
                    {slackEditorEnabled && (
                      <input
                        type="url"
                        value={slackEditorWebhook}
                        onChange={(e) => setSlackEditorWebhook(e.target.value)}
                        placeholder="https://hooks.slack.com/services/..."
                        className={`${inputClass} mt-3 text-sm`}
                      />
                    )}
                  </div>

                  {/* Post Ready */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Post Ready</span>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Get notified when content is ready to post</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSlackPostReadyEnabled(!slackPostReadyEnabled)}
                        className={`relative w-11 h-6 rounded-full transition-colors ${slackPostReadyEnabled ? "bg-brand-primary" : "bg-slate-300 dark:bg-slate-600"}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${slackPostReadyEnabled ? "translate-x-5" : ""}`} />
                      </button>
                    </label>
                    {slackPostReadyEnabled && (
                      <div className="mt-3 space-y-3">
                        <input
                          type="url"
                          value={slackPostReadyWebhook}
                          onChange={(e) => setSlackPostReadyWebhook(e.target.value)}
                          placeholder="Webhook URL: https://hooks.slack.com/services/..."
                          className={`${inputClass} text-sm`}
                        />
                        <input
                          type="text"
                          value={slackBotToken}
                          onChange={(e) => setSlackBotToken(e.target.value)}
                          placeholder="Bot token: xoxb-..."
                          className={`${inputClass} text-sm font-mono`}
                        />
                        <input
                          type="text"
                          value={slackChannelId}
                          onChange={(e) => setSlackChannelId(e.target.value)}
                          placeholder="Channel ID: C01234ABCDE"
                          className={`${inputClass} text-sm font-mono`}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-4">
                <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Summary</h4>
                <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                  <p><span className="font-medium">Business:</span> {businessName || "\u2014"}</p>
                  <p><span className="font-medium">Type:</span> {industry === "Other" ? customIndustry || "Other" : industry || "\u2014"}</p>
                  {teamSize && <p><span className="font-medium">Team:</span> {teamSize}</p>}
                  {serviceArea && <p><span className="font-medium">Area:</span> {serviceArea}</p>}
                  {brandVoice.length > 0 && <p><span className="font-medium">Voice:</span> {brandVoice.join(", ")}</p>}
                  {socialPlatforms.length > 0 && <p><span className="font-medium">Platforms:</span> {socialPlatforms.join(", ")}</p>}
                  {postingFrequency && <p><span className="font-medium">Frequency:</span> {postingFrequency}</p>}
                  {(slackFilmingEnabled || slackEditorEnabled || slackPostReadyEnabled) && (
                    <p><span className="font-medium">Slack:</span> {[slackFilmingEnabled && "Filming", slackEditorEnabled && "Editor", slackPostReadyEnabled && "Post Ready"].filter(Boolean).join(", ")}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500 mt-4 flex items-center gap-1.5">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </p>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="px-5 py-2.5 rounded-full bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {step < TOTAL_STEPS ? (
              <button
                type="button"
                onClick={() => { if (canProceed()) setStep(step + 1); }}
                disabled={!canProceed()}
                className="px-5 py-2.5 rounded-full bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || !businessName.trim()}
                className="px-6 py-2.5 rounded-full bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Setting up..." : "Complete Setup"}
              </button>
            )}
          </div>
        </div>

        {step < TOTAL_STEPS && (
          <button
            type="button"
            onClick={() => setStep(TOTAL_STEPS)}
            className="block mx-auto mt-4 text-sm text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Skip to finish
          </button>
        )}
      </div>
    </main>
  );
}
