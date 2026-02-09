"use client";

import { useState, useEffect, useCallback } from "react";
import { Company, Theme, ContentCounts, GeneratedContent, SavedContentItem, ToneStyle, CustomToneStyle, defaultCounts, toneOptions } from "@/types";
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
import { SkeletonGenerating, SkeletonSavedItem } from "@/components/Skeleton";

export default function Home() {
  const { toast } = useToast();
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null);
  const [counts, setCounts] = useState<ContentCounts>(defaultCounts);
  const [selectedTone, setSelectedTone] = useState<ToneStyle>(toneOptions[0]);
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

  // Keyboard shortcuts help
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setCurrentUser(data); })
      .catch(() => {});
  }, []);

  function handleSelectCompany(company: Company) {
    setSelectedCompany(company);
    setSelectedTheme(null);
    setContent(null);
    setImages({});
    setCurrentSavedId(null);
    loadSavedContent(company.id);
    loadCustomTones(company.id);
  }

  function handleBackToCompanies() {
    setSelectedCompany(null);
    setSelectedTheme(null);
    setContent(null);
    setImages({});
    setSavedContent([]);
    setCurrentSavedId(null);
    setCustomTones([]);
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
    setCurrentSavedId(null);
    setStreamingText("");
    try {
      const res = await fetch("/api/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, theme: selectedTheme, counts, tone: selectedTone }),
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setStreamingText(fullText);
      }

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

  async function generateImage(key: string, prompt: string, aspectRatio?: string) {
    setImageLoading((prev) => new Set(prev).add(key));
    try {
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, aspectRatio: aspectRatio || "1:1" }),
      });
      const data = await res.json();
      if (res.ok && data.imageBase64) {
        setImages((prev) => ({ ...prev, [key]: `data:${data.mimeType || "image/png"};base64,${data.imageBase64}` }));
      }
    } finally {
      setImageLoading((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function generateAllImages() {
    if (!content) return;
    const jobs: { key: string; prompt: string; aspectRatio: string }[] = [];
    content.posts.forEach((p, i) => {
      const key = `post-${i}`;
      if (!images[key]) jobs.push({ key, prompt: p.imagePrompt, aspectRatio: "1:1" });
    });
    content.reels.forEach((r, i) => {
      const key = `reel-${i}`;
      if (!images[key] && r.imagePrompt) jobs.push({ key, prompt: r.imagePrompt, aspectRatio: "9:16" });
    });
    content.linkedinArticles.forEach((a, i) => {
      const key = `article-${i}`;
      if (!images[key]) jobs.push({ key, prompt: a.imagePrompt, aspectRatio: "16:9" });
    });
    content.carousels.forEach((c, i) => {
      const totalSlides = c.slides.length;
      c.slides.forEach((s, j) => {
        const key = `carousel-${i}-slide-${j}`;
        if (!images[key]) jobs.push({ key, prompt: `Part ${j + 1} of ${totalSlides} in a cohesive carousel series. MUST maintain identical visual style, color palette, layout, and typography across all slides. Style: ${c.imagePrompt}. This slide's content: "${s.title} - ${s.body}"`, aspectRatio: "1:1" });
      });
    });
    content.quotesForX.forEach((q, i) => {
      const key = `quote-${i}`;
      if (!images[key]) jobs.push({ key, prompt: q.imagePrompt, aspectRatio: "1:1" });
    });
    content.youtube.forEach((y, i) => {
      const key = `yt-${i}`;
      if (!images[key] && y.thumbnailPrompt) jobs.push({ key, prompt: y.thumbnailPrompt, aspectRatio: "16:9" });
    });
    jobs.forEach((job) => generateImage(job.key, job.prompt, job.aspectRatio));
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
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <button
            onClick={handleBackToCompanies}
            className="flex items-center gap-2 text-indigo-100 hover:text-white mb-4 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to companies
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{selectedCompany.name}</h1>
              <p className="text-indigo-100 mt-1">Content themes from your memory - scripts, captions, articles & images</p>
            </div>
            <div className="flex items-center gap-2">
              {currentUser && (
                <span className="text-sm text-indigo-100 hidden sm:inline">
                  {currentUser.displayName}
                </span>
              )}
              {currentUser?.role === "admin" && (
                <Link
                  href="/admin"
                  className="p-2 rounded-lg text-indigo-100 hover:text-white hover:bg-white/10 transition-colors"
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
              <svg className="animate-spin h-5 w-5 text-indigo-600" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Generating content...
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
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-md"
                      : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-indigo-400"
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
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-md"
                      : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-indigo-400"
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
