"use client";

import { useState, useEffect, useCallback } from "react";
import { Company, Theme, ContentCounts, GeneratedContent, SavedContentItem, ToneStyle, CustomToneStyle, LanguageOption, defaultCounts, toneOptions, languageOptions } from "@/types";
import Link from "next/link";
import CompanySelector from "@/components/CompanySelector";
import MemoryManager from "@/components/MemoryManager";
import SavedContentList from "@/components/SavedContentList";
import ThemeSelector from "@/components/ThemeSelector";
import ContentGenerator from "@/components/ContentGenerator";
import ContentResults from "@/components/ContentResults";
import ContentCalendar from "@/components/ContentCalendar";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useToast } from "@/components/ToastProvider";
import { SkeletonGenerating, SkeletonSavedItem, ElapsedTimer } from "@/components/Skeleton";

export default function Home() {
  const { toast } = useToast();
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null);
  const [counts, setCounts] = useState<ContentCounts>(defaultCounts);
  const [selectedTone, setSelectedTone] = useState<ToneStyle>(toneOptions[0]);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageOption>(languageOptions[0]);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [images, setImages] = useState<Record<string, string>>({});
  const [imageLoading, setImageLoading] = useState<Set<string>>(new Set());
  const [streamingText, setStreamingText] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  // Saved content state
  const [savedContent, setSavedContent] = useState<SavedContentItem[]>([]);
  const [savedContentLoading, setSavedContentLoading] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [saveContentName, setSaveContentName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(null);

  // Custom tones state
  const [customTones, setCustomTones] = useState<CustomToneStyle[]>([]);

  // Current user info
  const [currentUser, setCurrentUser] = useState<{ displayName: string; role: string } | null>(null);

  // Brand settings state
  const [showBrandSettings, setShowBrandSettings] = useState(false);

  // Keyboard shortcuts help
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Autosave: track whether we've restored from localStorage
  const [autosaveRestored, setAutosaveRestored] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setCurrentUser(data); })
      .catch(() => {});
  }, []);

  // Autosave: save working state to localStorage when content changes
  useEffect(() => {
    if (!autosaveRestored) return; // don't overwrite before restore
    if (!selectedCompany || !content) {
      // Clear autosave when there's no content
      if (selectedCompany && !content) {
        localStorage.removeItem(`pc-autosave-${selectedCompany.id}`);
      }
      return;
    }
    const data = {
      theme: selectedTheme,
      content,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(`pc-autosave-${selectedCompany.id}`, JSON.stringify(data));
    } catch {
      // localStorage quota exceeded - silently fail
    }
  }, [autosaveRestored, selectedCompany, selectedTheme, content]);

  function handleSelectCompany(company: Company) {
    setSelectedCompany(company);
    setSelectedTheme(null);
    setContent(null);
    setImages({});
    setCurrentSavedId(null);
    loadSavedContent(company.id);
    loadCustomTones(company.id);

    // Autosave: restore if available
    try {
      const saved = localStorage.getItem(`pc-autosave-${company.id}`);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.content && data.theme) {
          setSelectedTheme(data.theme);
          setContent(data.content);
          toast("Restored your previous work", "info");
        }
      }
    } catch {
      // corrupt data, ignore
    }
    setAutosaveRestored(true);
  }

  function handleBackToCompanies() {
    setSelectedCompany(null);
    setSelectedTheme(null);
    setContent(null);
    setImages({});
    setSavedContent([]);
    setCurrentSavedId(null);
    setCustomTones([]);
    setAutosaveRestored(false);
  }

  async function updateCompanyBrand(updates: { logo?: string; brandColors?: string[] }) {
    if (!selectedCompany) return;
    try {
      const res = await fetch("/api/companies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedCompany.id, ...updates }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSelectedCompany(updated);
      } else {
        const data = await res.json();
        toast(data.error || "Failed to update brand settings", "error");
      }
    } catch {
      toast("Failed to update brand settings", "error");
    }
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast("Logo must be under 2MB", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      updateCompanyBrand({ logo: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleAddBrandColor(color: string) {
    const current = selectedCompany?.brandColors || [];
    if (current.length >= 6) { toast("Maximum 6 brand colors", "error"); return; }
    updateCompanyBrand({ brandColors: [...current, color] });
  }

  function handleRemoveBrandColor(index: number) {
    const current = selectedCompany?.brandColors || [];
    updateCompanyBrand({ brandColors: current.filter((_, i) => i !== index) });
  }

  function handleSelectTheme(theme: Theme) {
    setSelectedTheme(theme);
    setContent(null);
  }

  async function loadSavedContent(companyId: string) {
    setSavedContentLoading(true);
    try {
      const res = await fetch(`/api/saved-content?companyId=${companyId}`);
      const data = await res.json();
      if (res.ok && data.items) setSavedContent(data.items);
    } catch {
      // ignore
    } finally {
      setSavedContentLoading(false);
    }
  }

  async function loadCustomTones(companyId: string) {
    try {
      const res = await fetch(`/api/custom-tones?companyId=${companyId}`);
      const data = await res.json();
      if (res.ok && data.tones) setCustomTones(data.tones);
    } catch {
      // ignore
    }
  }

  async function handleAddCustomTone(label: string, prompt: string) {
    if (!selectedCompany) return;
    try {
      const res = await fetch("/api/custom-tones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, label, prompt }),
      });
      if (res.ok) {
        const tone: CustomToneStyle = await res.json();
        setCustomTones((prev) => [tone, ...prev]);
        setSelectedTone(tone);
        toast("Custom tone created", "success");
      } else {
        const data = await res.json();
        toast(data.error || "Failed to create custom tone", "error");
      }
    } catch {
      toast("Failed to create custom tone", "error");
    }
  }

  async function handleDeleteCustomTone(id: string) {
    if (!selectedCompany) return;
    const res = await fetch(`/api/custom-tones?companyId=${selectedCompany.id}&id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setCustomTones((prev) => prev.filter((t) => t.id !== id));
      if (selectedTone.id === id) setSelectedTone(toneOptions[0]);
    }
  }

  const handleGenerateContent = useCallback(async () => {
    if (!selectedCompany || !selectedTheme) return;
    setContentLoading(true);
    setContent(null);
    setImages({});
    setCurrentSavedId(null);
    setStreamingText("");
    try {
      const res = await fetch("/api/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, theme: selectedTheme, counts, tone: selectedTone, language: selectedLanguage }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast(data.error || "Failed to generate content", "error");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { toast("Streaming not supported", "error"); return; }

      const decoder = new TextDecoder();
      let fullText = "";
      let lastUpdate = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        const now = Date.now();
        if (now - lastUpdate >= 100) {
          setStreamingText(fullText);
          lastUpdate = now;
        }
      }
      setStreamingText(fullText);

      try {
        const cleaned = fullText.replace(/^```json?\s*|\s*```$/g, "").trim();
        const parsed = JSON.parse(cleaned) as GeneratedContent;
        setContent(parsed);
        setStreamingText("");
        toast("Content generated successfully", "success");
      } catch {
        toast("Failed to parse generated content", "error");
      }
    } finally {
      setContentLoading(false);
    }
  }, [selectedCompany, selectedTheme, counts, selectedTone, toast]);

  async function generateImage(key: string, prompt: string, aspectRatio?: string, referenceImage?: string): Promise<string | null> {
    setImageLoading((prev) => new Set(prev).add(key));
    try {
      const body: Record<string, string> = { prompt, aspectRatio: aspectRatio || "1:1" };
      if (referenceImage) body.referenceImage = referenceImage;
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.imageBase64) {
        const dataUrl = `data:${data.mimeType || "image/png"};base64,${data.imageBase64}`;
        setImages((prev) => ({ ...prev, [key]: dataUrl }));
        return data.imageBase64;
      }
      return null;
    } finally {
      setImageLoading((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function generateCarouselImages(carouselIndex: number) {
    if (!content) return;
    const c = content.carousels[carouselIndex];
    if (!c) return;

    const allTitles = c.slides.map((sl, idx) => `${idx + 1}. ${sl.title}`).join("; ");

    function buildPrompt(slideIndex: number): string {
      const s = c.slides[slideIndex];
      const prompt = `Create a social media carousel slide image. Overall carousel topic with ${c.slides.length} slides: [${allTitles}]. This slide (${slideIndex + 1} of ${c.slides.length}): "${s.title} - ${s.body}". Visual style for ALL slides: ${c.imagePrompt}. IMPORTANT: Use a consistent layout, typography, illustration style, and color scheme that would look unified across all slides in this carousel. Do not include any logo or watermark.`;
      return addBrandColors(prompt);
    }

    // Step 1: Generate slide 1 first to establish the style
    const firstKey = `carousel-${carouselIndex}-slide-0`;
    const firstBase64 = await generateImage(firstKey, buildPrompt(0), "1:1");
    if (!firstBase64) return; // failed, bail

    // Step 2: Generate remaining slides in parallel, using slide 1 as reference
    const remaining = c.slides.slice(1).map((_, j) => {
      const slideIndex = j + 1;
      const slideKey = `carousel-${carouselIndex}-slide-${slideIndex}`;
      return generateImage(slideKey, buildPrompt(slideIndex), "1:1", firstBase64);
    });
    await Promise.all(remaining);
  }

  function addBrandColors(prompt: string): string {
    const colors = selectedCompany?.brandColors;
    if (colors && colors.length > 0) return `${prompt}. Use these brand colors: ${colors.join(", ")}`;
    return prompt;
  }

  async function generateAllImages() {
    if (!content) return;
    const MAX_CONCURRENT = 3;
    // Non-carousel images: generate with concurrency limit
    const jobs: { key: string; prompt: string; aspectRatio: string }[] = [];
    content.posts.forEach((p, i) => {
      const key = `post-${i}`;
      if (!images[key]) jobs.push({ key, prompt: addBrandColors(p.imagePrompt), aspectRatio: "1:1" });
    });
    content.reels.forEach((r, i) => {
      const key = `reel-${i}`;
      if (!images[key] && r.imagePrompt) jobs.push({ key, prompt: addBrandColors(r.imagePrompt), aspectRatio: "9:16" });
    });
    content.linkedinArticles.forEach((a, i) => {
      const key = `article-${i}`;
      if (!images[key]) jobs.push({ key, prompt: addBrandColors(a.imagePrompt), aspectRatio: "16:9" });
    });
    content.quotesForX.forEach((q, i) => {
      const key = `quote-${i}`;
      if (!images[key]) jobs.push({ key, prompt: addBrandColors(q.imagePrompt), aspectRatio: "1:1" });
    });
    content.youtube.forEach((y, i) => {
      const key = `yt-${i}`;
      if (!images[key] && y.thumbnailPrompt) jobs.push({ key, prompt: addBrandColors(y.thumbnailPrompt), aspectRatio: "16:9" });
    });

    // Process non-carousel jobs with max-3-concurrent queue
    let i = 0;
    async function runNext(): Promise<void> {
      while (i < jobs.length) {
        const job = jobs[i++];
        await generateImage(job.key, job.prompt, job.aspectRatio);
      }
    }
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, jobs.length) }, () => runNext());
    await Promise.all(workers);

    // Carousels: sequential (slide 1 first, then rest with reference)
    content.carousels.forEach((_, ci) => {
      const hasAnyPending = content.carousels[ci].slides.some((__, j) => !images[`carousel-${ci}-slide-${j}`]);
      if (hasAnyPending) generateCarouselImages(ci);
    });
  }

  function handleLoadSaved(item: SavedContentItem) {
    setSelectedTheme(item.theme);
    setContent(item.content);
    setCurrentSavedId(item.id);
    setImages({});
  }

  async function handleDeleteSaved(id: string) {
    if (!selectedCompany) return;
    const res = await fetch(`/api/saved-content?companyId=${selectedCompany.id}&id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setSavedContent((prev) => prev.filter((item) => item.id !== id));
      if (currentSavedId === id) setCurrentSavedId(null);
    }
  }

  async function handleBulkDeleteSaved(ids: string[]) {
    if (!selectedCompany) return;
    const results = await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/saved-content?companyId=${selectedCompany.id}&id=${id}`, { method: "DELETE" })
      )
    );
    const deletedIds = ids.filter((_, i) => results[i].status === "fulfilled" && (results[i] as PromiseFulfilledResult<Response>).value.ok);
    if (deletedIds.length > 0) {
      const deletedSet = new Set(deletedIds);
      setSavedContent((prev) => prev.filter((item) => !deletedSet.has(item.id)));
      if (currentSavedId && deletedSet.has(currentSavedId)) setCurrentSavedId(null);
    }
  }

  const handleSaveContent = useCallback(async () => {
    if (!selectedCompany || !content || !selectedTheme || !saveContentName.trim()) return;
    setSavingContent(true);
    try {
      const res = await fetch("/api/saved-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, name: saveContentName.trim(), theme: selectedTheme, content }),
      });
      if (res.ok) {
        const item = await res.json();
        setSavedContent((prev) => [item, ...prev]);
        setCurrentSavedId(item.id);
        setShowSaveDialog(false);
        setSaveContentName("");
        toast("Content saved successfully", "success");
      } else {
        const data = await res.json();
        toast(data.error || "Failed to save content", "error");
      }
    } finally {
      setSavingContent(false);
    }
  }, [selectedCompany, content, selectedTheme, saveContentName, toast]);

  const handleUpdateSavedContent = useCallback(async () => {
    if (!selectedCompany || !content || !currentSavedId) return;
    setSavingContent(true);
    try {
      const res = await fetch("/api/saved-content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, id: currentSavedId, content }),
      });
      if (res.ok) {
        setSavedContent((prev) => prev.map((item) => (item.id === currentSavedId ? { ...item, content } : item)));
        toast("Content updated successfully", "success");
      } else {
        const data = await res.json();
        toast(data.error || "Failed to update content", "error");
      }
    } finally {
      setSavingContent(false);
    }
  }, [selectedCompany, content, currentSavedId, toast]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Ctrl/Cmd+S: Save content
      if (e.key === "s") {
        e.preventDefault();
        if (!content || !selectedCompany || !selectedTheme) {
          toast("No content to save", "info");
          return;
        }
        if (currentSavedId) {
          handleUpdateSavedContent();
        } else {
          setShowSaveDialog(true);
        }
      }

      // Ctrl/Cmd+G: Generate content
      if (e.key === "g") {
        e.preventDefault();
        if (!selectedTheme) {
          toast("Select a theme first", "info");
          return;
        }
        if (contentLoading) {
          toast("Generation already in progress", "info");
          return;
        }
        handleGenerateContent();
      }

      // Ctrl/Cmd+E: Toggle edit mode (dispatched as custom event for ContentResults)
      if (e.key === "e") {
        e.preventDefault();
        if (!content) {
          toast("No content to edit", "info");
          return;
        }
        window.dispatchEvent(new CustomEvent("toggle-edit-mode"));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [content, selectedCompany, selectedTheme, currentSavedId, contentLoading, handleGenerateContent, handleSaveContent, handleUpdateSavedContent, toast]);

  if (!selectedCompany) {
    return <CompanySelector onSelect={handleSelectCompany} />;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-sky-50 dark:from-slate-900 dark:to-sky-950">
      <header className="bg-sky-600 text-white">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <button
            onClick={handleBackToCompanies}
            className="flex items-center gap-2 text-sky-100 hover:text-white mb-4 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to companies
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{selectedCompany.name}</h1>
              <p className="text-sky-100 mt-1">Content themes from your memory - scripts, captions, articles & images</p>
            </div>
            <div className="flex items-center gap-2">
              {currentUser && (
                <span className="text-sm text-sky-100 hidden sm:inline">
                  {currentUser.displayName}
                </span>
              )}
              {currentUser?.role === "admin" && (
                <Link
                  href="/admin"
                  className="p-2 rounded-lg text-sky-100 hover:text-white hover:bg-white/10 transition-colors"
                  title="User management"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </Link>
              )}
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8 pb-20">
        {/* Brand Settings */}
        <section className="mb-8">
          <button
            onClick={() => setShowBrandSettings(!showBrandSettings)}
            className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform ${showBrandSettings ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Brand Settings
            {(selectedCompany.logo || (selectedCompany.brandColors && selectedCompany.brandColors.length > 0)) && (
              <span className="w-2 h-2 rounded-full bg-green-500" />
            )}
          </button>
          {showBrandSettings && (
            <div className="mt-3 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Logo */}
                <div>
                  <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-3">Logo</h4>
                  {selectedCompany.logo ? (
                    <div className="flex items-center gap-4">
                      <img src={selectedCompany.logo} alt="Logo" className="w-16 h-16 rounded-lg object-contain border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1" />
                      <button
                        onClick={() => updateCompanyBrand({ logo: "" })}
                        className="text-sm text-red-500 hover:text-red-700 dark:hover:text-red-400 font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">No logo uploaded</p>
                  )}
                  <label className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
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
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(selectedCompany.brandColors || []).map((color, i) => (
                      <button
                        key={i}
                        onClick={() => handleRemoveBrandColor(i)}
                        title={`${color} — click to remove`}
                        className="w-8 h-8 rounded-full border-2 border-slate-300 dark:border-slate-600 hover:border-red-400 dark:hover:border-red-500 transition-colors hover:scale-110"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    {(selectedCompany.brandColors || []).length < 6 && (
                      <label className="w-8 h-8 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center cursor-pointer hover:border-sky-400 dark:hover:border-sky-500 transition-colors">
                        <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <input
                          type="color"
                          className="hidden"
                          onChange={(e) => handleAddBrandColor(e.target.value)}
                        />
                      </label>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {(selectedCompany.brandColors || []).length}/6 colors. Click a swatch to remove it.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        <MemoryManager companyId={selectedCompany.id} />

        <ErrorBoundary fallbackTitle="Failed to load saved content">
          {savedContentLoading ? (
            <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-6 h-6 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
                <div className="h-6 w-40 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
              </div>
              <div className="space-y-3">
                <SkeletonSavedItem />
                <SkeletonSavedItem />
              </div>
            </section>
          ) : (
            <SavedContentList
              items={savedContent}
              currentSavedId={currentSavedId}
              onLoad={handleLoadSaved}
              onDelete={handleDeleteSaved}
              onBulkDelete={handleBulkDeleteSaved}
            />
          )}
        </ErrorBoundary>

        <ErrorBoundary fallbackTitle="Failed to load theme selector">
          <ThemeSelector
            companyId={selectedCompany.id}
            selectedTheme={selectedTheme}
            onSelectTheme={handleSelectTheme}
          />
        </ErrorBoundary>

        {selectedTheme && (
          <ErrorBoundary fallbackTitle="Failed to load content generator">
            <ContentGenerator
              selectedTheme={selectedTheme}
              counts={counts}
              onCountsChange={setCounts}
              selectedTone={selectedTone}
              onToneChange={setSelectedTone}
              selectedLanguage={selectedLanguage}
              onLanguageChange={setSelectedLanguage}
              onGenerate={handleGenerateContent}
              loading={contentLoading}
              customTones={customTones}
              onAddCustomTone={handleAddCustomTone}
              onDeleteCustomTone={handleDeleteCustomTone}
            />
          </ErrorBoundary>
        )}

        {contentLoading && !streamingText && (
          <SkeletonGenerating />
        )}

        {contentLoading && streamingText && (
          <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-sky-600" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Generating content... <ElapsedTimer />
            </h2>
            <pre className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap max-h-64 overflow-y-auto bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 font-mono">
              {streamingText}
            </pre>
          </section>
        )}

        {content && (
          <ErrorBoundary fallbackTitle="Failed to render content">
            <>
              <div className="flex items-center gap-2 mb-4">
                <button
                  onClick={() => setViewMode("list")}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                    viewMode === "list"
                      ? "bg-sky-600 text-white border-sky-600 shadow-md"
                      : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-sky-400"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  List
                </button>
                <button
                  onClick={() => setViewMode("calendar")}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                    viewMode === "calendar"
                      ? "bg-sky-600 text-white border-sky-600 shadow-md"
                      : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-sky-400"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Calendar
                </button>
              </div>

              {viewMode === "calendar" ? (
                <ErrorBoundary fallbackTitle="Failed to render calendar">
                  <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
                    <ContentCalendar content={content} startDate={new Date()} />
                  </section>
                </ErrorBoundary>
              ) : (
                <ContentResults
                  content={content}
                  onChange={setContent}
                  companyId={selectedCompany.id}
                  theme={selectedTheme!}
                  tone={selectedTone}
                  language={selectedLanguage}
                  images={images}
                  imageLoading={imageLoading}
                  onGenerateImage={generateImage}
                  onGenerateAllImages={generateAllImages}
                  currentSavedId={currentSavedId}
                  savingContent={savingContent}
                  onSave={handleSaveContent}
                  onUpdate={handleUpdateSavedContent}
                  showSaveDialog={showSaveDialog}
                  onShowSaveDialog={setShowSaveDialog}
                  saveContentName={saveContentName}
                  onSaveContentNameChange={setSaveContentName}
                  onSaveContent={handleSaveContent}
                  brandColors={selectedCompany.brandColors}
                  onDeleteImage={(key) => setImages((prev) => { const next = { ...prev }; delete next[key]; return next; })}
                  onGenerateCarouselImages={generateCarouselImages}
                />
              )}
            </>
          </ErrorBoundary>
        )}
      </div>

      {/* Keyboard shortcuts help button */}
      <div className="fixed bottom-6 left-6 z-40">
        <div className="relative">
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="w-9 h-9 rounded-full bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800 flex items-center justify-center shadow-lg hover:bg-slate-700 dark:hover:bg-slate-300 transition-colors text-sm font-bold"
            title="Keyboard shortcuts"
          >
            ?
          </button>
          {showShortcuts && (
            <div className="absolute bottom-12 left-0 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4 w-64">
              <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-sm mb-3">Keyboard Shortcuts</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Save / Update content</span>
                  <kbd className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-mono border border-slate-200 dark:border-slate-600">Cmd+S</kbd>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Generate content</span>
                  <kbd className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-mono border border-slate-200 dark:border-slate-600">Cmd+G</kbd>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Toggle edit mode</span>
                  <kbd className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-mono border border-slate-200 dark:border-slate-600">Cmd+E</kbd>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-3">Use Ctrl on Windows/Linux</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
