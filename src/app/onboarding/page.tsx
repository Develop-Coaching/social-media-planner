"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

const INDUSTRIES = [
  "Marketing", "Health & Fitness", "Tech", "Finance", "Education",
  "Food & Beverage", "Real Estate", "Fashion", "Other",
];

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

const TOTAL_STEPS = 4;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [customIndustry, setCustomIndustry] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [brandVoice, setBrandVoice] = useState<string[]>([]);
  const [contentTopics, setContentTopics] = useState("");
  const [website, setWebsite] = useState("");
  const [socialPlatforms, setSocialPlatforms] = useState<string[]>([]);
  const [postingFrequency, setPostingFrequency] = useState("");
  const [contentTypes, setContentTypes] = useState<string[]>([]);
  const [uniqueValue, setUniqueValue] = useState("");

  function toggleChip(value: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function canProceed(): boolean {
    if (step === 1) return !!businessName.trim();
    return true; // Other steps are optional
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
          brandVoice,
          contentTopics: contentTopics.trim(),
          website: website.trim(),
          socialPlatforms,
          postingFrequency,
          contentTypes,
          uniqueValue: uniqueValue.trim(),
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
          {/* Step 1: Business Name, Industry, Target Audience */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  What&apos;s your business/brand name? <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Develop Coaching"
                  autoFocus
                  className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  What industry are you in?
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none"
                >
                  <option value="">Select industry...</option>
                  {INDUSTRIES.map((ind) => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
                {industry === "Other" && (
                  <input
                    type="text"
                    value={customIndustry}
                    onChange={(e) => setCustomIndustry(e.target.value)}
                    placeholder="Enter your industry"
                    className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none mt-3"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Who is your target audience?
                </label>
                <textarea
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="Demographics, interests, pain points..."
                  rows={3}
                  className="w-full rounded-2xl border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 2: Brand Voice, Content Topics */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  What&apos;s your brand voice/personality?
                </label>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">Select all that apply</p>
                <div className="flex flex-wrap gap-2">
                  {BRAND_VOICES.map((voice) => (
                    <button
                      key={voice}
                      type="button"
                      onClick={() => toggleChip(voice, brandVoice, setBrandVoice)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                        brandVoice.includes(voice)
                          ? "bg-brand-primary text-white border-brand-primary"
                          : "bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-brand-primary"
                      }`}
                    >
                      {voice}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  What topics do you regularly create content about?
                </label>
                <textarea
                  value={contentTopics}
                  onChange={(e) => setContentTopics(e.target.value)}
                  placeholder="Key themes, recurring topics, expertise areas..."
                  rows={3}
                  className="w-full rounded-2xl border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  What&apos;s your website URL?
                </label>
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://yourwebsite.com (optional)"
                  className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Step 3: Platforms, Frequency */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  What social media platforms do you use?
                </label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => toggleChip(platform, socialPlatforms, setSocialPlatforms)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                        socialPlatforms.includes(platform)
                          ? "bg-brand-primary text-white border-brand-primary"
                          : "bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-brand-primary"
                      }`}
                    >
                      {platform}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  How often do you post content?
                </label>
                <select
                  value={postingFrequency}
                  onChange={(e) => setPostingFrequency(e.target.value)}
                  className="w-full rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none"
                >
                  <option value="">Select frequency...</option>
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  What content types do you create most?
                </label>
                <div className="flex flex-wrap gap-2">
                  {CONTENT_TYPES.map((ct) => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => toggleChip(ct, contentTypes, setContentTypes)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                        contentTypes.includes(ct)
                          ? "bg-brand-primary text-white border-brand-primary"
                          : "bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-brand-primary"
                      }`}
                    >
                      {ct}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Unique Value */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  What makes your brand unique? What sets you apart?
                </label>
                <textarea
                  value={uniqueValue}
                  onChange={(e) => setUniqueValue(e.target.value)}
                  placeholder="Your unique selling points, brand story, what makes you different..."
                  rows={5}
                  autoFocus
                  className="w-full rounded-2xl border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none resize-none"
                />
              </div>

              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-4">
                <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Summary</h4>
                <div className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                  <p><span className="font-medium">Business:</span> {businessName || "\u2014"}</p>
                  <p><span className="font-medium">Industry:</span> {industry === "Other" ? customIndustry || "Other" : industry || "\u2014"}</p>
                  {brandVoice.length > 0 && <p><span className="font-medium">Voice:</span> {brandVoice.join(", ")}</p>}
                  {socialPlatforms.length > 0 && <p><span className="font-medium">Platforms:</span> {socialPlatforms.join(", ")}</p>}
                  {postingFrequency && <p><span className="font-medium">Frequency:</span> {postingFrequency}</p>}
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
