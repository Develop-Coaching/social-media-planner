"use client";

import { useState, useEffect, useCallback } from "react";
import { Company, Character, Theme, ContentCounts, GeneratedContent, SavedContentItem, ToneStyle, CustomToneStyle, LanguageOption, defaultCounts, toneOptions, languageOptions } from "@/types";
import Link from "next/link";
import CompanySelector from "@/components/CompanySelector";
import FontPicker from "@/components/FontPicker";
import MemoryManager from "@/components/MemoryManager";
import SavedContentList from "@/components/SavedContentList";
import ThemeSelector from "@/components/ThemeSelector";
import ContentGenerator from "@/components/ContentGenerator";
import ContentResults from "@/components/ContentResults";
import CharacterManager from "@/components/CharacterManager";
import ContentCalendar from "@/components/ContentCalendar";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useToast } from "@/components/ToastProvider";
import { SkeletonGenerating, ElapsedTimer } from "@/components/Skeleton";
import { buildBrandCssVars, isLightColor } from "@/lib/brand-theme";

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export default function Home() {
  const { toast } = useToast();
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [showSavedContent, setShowSavedContent] = useState(false);
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
  const [postingDates, setPostingDates] = useState<Record<string, string>>({});

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
  const [characters, setCharacters] = useState<Character[]>([]);
  const [charactersLoading, setCharactersLoading] = useState(false);

  // Slack settings UI state
  const [showAdvancedSlack, setShowAdvancedSlack] = useState(false);

  // Google Drive integration
  const [driveStatus, setDriveStatus] = useState<{ enabled: boolean; authenticated: boolean; email?: string; clientId?: string }>({ enabled: false, authenticated: false });

  // Keyboard shortcuts help
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Autosave: track whether we've restored from localStorage
  const [autosaveRestored, setAutosaveRestored] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setCurrentUser(data); })
      .catch(() => {});
    fetch("/api/drive/status")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setDriveStatus(data); })
      .catch(() => {});
  }, []);

  // Autosave: save working state to localStorage when content changes
  useEffect(() => {
    if (!autosaveRestored) return;
    if (!selectedCompany || !content) {
      if (selectedCompany && !content) {
        localStorage.removeItem(`pc-autosave-${selectedCompany.id}`);
      }
      return;
    }
    const data = {
      theme: selectedTheme,
      content,
      postingDates,
      currentSavedId,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(`pc-autosave-${selectedCompany.id}`, JSON.stringify(data));
    } catch {
      // localStorage quota exceeded - silently fail
    }
  }, [autosaveRestored, selectedCompany, selectedTheme, content, postingDates, currentSavedId]);

  async function loadCharacters(companyId: string) {
    setCharactersLoading(true);
    try {
      const res = await fetch(`/api/characters?companyId=${companyId}`);
      const data = await res.json();
      if (res.ok && data.characters) setCharacters(data.characters);
    } catch {
      // ignore
    } finally {
      setCharactersLoading(false);
    }
  }

  function handleSelectCompany(company: Company) {
    setSelectedCompany(company);
    setSelectedTheme(null);
    setContent(null);
    setImages({});
    setCurrentSavedId(null);
    setPostingDates({});
    loadSavedContent(company.id);
    loadCustomTones(company.id);
    loadCharacters(company.id);

    // Restore autosave from localStorage
    try {
      const raw = localStorage.getItem(`pc-autosave-${company.id}`);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.savedAt && Date.now() - data.savedAt < 24 * 60 * 60 * 1000) {
          if (data.theme) setSelectedTheme(data.theme);
          if (data.content) setContent(data.content);
          if (data.postingDates) setPostingDates(data.postingDates);
          if (data.currentSavedId) setCurrentSavedId(data.currentSavedId);
        }
      }
    } catch {
      // ignore
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
    setCharacters([]);
    setPostingDates({});
    setAutosaveRestored(false);
  }

  async function handleLoadProject(item: SavedContentItem) {
    if (!selectedCompany) return;
    setSelectedTheme(item.theme);
    setContent(item.content);
    setCurrentSavedId(item.id);
    setPostingDates({});
    setStreamingText("");

    // Load images for this specific project
    try {
      const res = await fetch(`/api/images?companyId=${selectedCompany.id}&savedContentId=${item.id}`);
      const data = await res.json();
      if (res.ok && data.images) {
        setImages(data.images);
      } else {
        setImages({});
      }
    } catch {
      setImages({});
    }
  }

  async function updateCompanySlack(updates: { slackWebhookUrl?: string; slackEditorWebhookUrl?: string; slackBotToken?: string; slackChannelId?: string }) {
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
        toast(data.error || "Failed to update Slack settings", "error");
      }
    } catch {
      toast("Failed to update Slack settings", "error");
    }
  }

  async function updateCompanyBrand(updates: { logo?: string; brandColors?: string[]; fontFamily?: string }) {
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

  function handleReorderBrandColors(fromIndex: number, toIndex: number) {
    const current = [...(selectedCompany?.brandColors || [])];
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= current.length || toIndex >= current.length) return;
    const [moved] = current.splice(fromIndex, 1);
    current.splice(toIndex, 0, moved);
    updateCompanyBrand({ brandColors: current });
  }

  async function handleAddCharacter() {
    if (!selectedCompany) return;
    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, name: "New Character", description: "" }),
      });
      if (res.ok) {
        const char: Character = await res.json();
        setCharacters((prev) => [...prev, char]);
      } else {
        const data = await res.json();
        toast(data.error || "Failed to add character", "error");
      }
    } catch {
      toast("Failed to add character", "error");
    }
  }

  async function handleUpdateCharacter(characterId: string, updates: { name?: string; description?: string }) {
    if (!selectedCompany) return;
    try {
      const res = await fetch("/api/characters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, characterId, ...updates }),
      });
      if (res.ok) {
        const updated: Character = await res.json();
        setCharacters((prev) => prev.map((c) => (c.id === characterId ? updated : c)));
      }
    } catch {
      // ignore debounced update errors
    }
  }

  async function handleDeleteCharacter(characterId: string) {
    if (!selectedCompany) return;
    try {
      const res = await fetch(`/api/characters?companyId=${selectedCompany.id}&characterId=${characterId}`, { method: "DELETE" });
      if (res.ok) {
        setCharacters((prev) => prev.filter((c) => c.id !== characterId));
      }
    } catch {
      toast("Failed to delete character", "error");
    }
  }

  async function handleUploadCharacterImage(characterId: string, dataUrl: string) {
    if (!selectedCompany) return;
    try {
      const res = await fetch("/api/characters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, characterId, image: dataUrl }),
      });
      if (res.ok) {
        const updated: Character = await res.json();
        setCharacters((prev) => prev.map((c) => (c.id === characterId ? updated : c)));
      } else {
        const data = await res.json();
        toast(data.error || "Failed to upload image", "error");
      }
    } catch {
      toast("Failed to upload image", "error");
    }
  }

  async function handleRemoveCharacterImage(characterId: string) {
    if (!selectedCompany) return;
    try {
      const res = await fetch("/api/characters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, characterId, image: "" }),
      });
      if (res.ok) {
        const updated: Character = await res.json();
        setCharacters((prev) => prev.map((c) => (c.id === characterId ? updated : c)));
      }
    } catch {
      toast("Failed to remove image", "error");
    }
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
    setPostingDates({});
    setCurrentSavedId(null);
    setStreamingText("");
    try {
      const mobile = isMobileDevice();
      const url = mobile ? "/api/generate-content?stream=false" : "/api/generate-content";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id, theme: selectedTheme, counts, tone: selectedTone, language: selectedLanguage }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast(data.error || "Failed to generate content", "error");
        return;
      }

      let fullText: string;

      if (mobile) {
        fullText = await res.text();
      } else {
        const reader = res.body?.getReader();
        if (!reader) { toast("Streaming not supported", "error"); return; }

        const decoder = new TextDecoder();
        fullText = "";
        let lastUpdate = 0;

        try {
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
          const remaining = decoder.decode();
          if (remaining) fullText += remaining;
        } catch {
          setStreamingText(fullText);
          toast("Connection lost during generation — partial content shown below", "error");
          return;
        }
        setStreamingText(fullText);
      }

      try {
        const cleaned = fullText.replace(/^```json?\s*|\s*```$/g, "").trim();
        const parsed = JSON.parse(cleaned) as GeneratedContent;
        setContent(parsed);
        setStreamingText("");
        toast("Content generated successfully", "success");
      } catch {
        setStreamingText(fullText);
        toast("Failed to parse generated content — raw output shown below", "error");
      }
    } finally {
      setContentLoading(false);
    }
  }, [selectedCompany, selectedTheme, counts, selectedTone, selectedLanguage, toast]);

  function getCharacterReferenceImages(): { base64: string; mimeType: string }[] {
    return characters
      .filter((c) => c.imageUrl && c.imageMimeType)
      .map((c) => {
        const match = c.imageUrl!.match(/^data:[^;]+;base64,(.+)$/);
        return {
          base64: match ? match[1] : c.imageUrl!,
          mimeType: c.imageMimeType!,
        };
      });
  }

  async function generateImage(key: string, prompt: string, aspectRatio?: string, referenceImage?: string): Promise<string | null> {
    setImageLoading((prev) => new Set(prev).add(key));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = { prompt, aspectRatio: aspectRatio || "1:1" };
      if (referenceImage) body.referenceImage = referenceImage;
      const charImages = getCharacterReferenceImages();
      if (charImages.length > 0) body.characterReferenceImages = charImages;
      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.imageBase64) {
        const dataUrl = `data:${data.mimeType || "image/png"};base64,${data.imageBase64}`;
        setImages((prev) => ({ ...prev, [key]: dataUrl }));
        // Persist to server (fire-and-forget) only if project is already saved
        if (selectedCompany && currentSavedId) {
          fetch("/api/images", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId: selectedCompany.id, savedContentId: currentSavedId, key, dataUrl }),
          }).catch(() => {});
        }
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
      return addBrandContext(prompt);
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

  function addBrandContext(prompt: string): string {
    const colors = selectedCompany?.brandColors;
    let enhanced = prompt;
    if (colors && colors.length > 0) {
      enhanced += `. The brand colors are ${colors.join(", ")} — use these as a subtle reference for accents and design elements, but do not fill the entire image with these colors`;
    }
    if (characters.length > 0) {
      const charDescs = characters.map((c) => `${c.name}: ${c.description}`).join(". ");
      enhanced += `. Characters/people to feature: ${charDescs}`;
    }
    return enhanced;
  }

  async function generateAllImages() {
    if (!content) return;
    const MAX_CONCURRENT = 3;
    // Non-carousel images: generate with concurrency limit
    const jobs: { key: string; prompt: string; aspectRatio: string }[] = [];
    content.posts.forEach((p, i) => {
      const key = `post-${i}`;
      if (!images[key]) jobs.push({ key, prompt: addBrandContext(p.imagePrompt), aspectRatio: "1:1" });
    });
    // Reels have no image prompts
    content.linkedinArticles.forEach((a, i) => {
      const key = `article-${i}`;
      if (!images[key]) jobs.push({ key, prompt: addBrandContext(a.imagePrompt), aspectRatio: "16:9" });
    });
    content.quotesForX.forEach((q, i) => {
      const key = `quote-${i}`;
      if (!images[key]) jobs.push({ key, prompt: addBrandContext(q.imagePrompt), aspectRatio: "1:1" });
    });
    content.youtube.forEach((y, i) => {
      const key = `yt-${i}`;
      if (!images[key] && y.thumbnailPrompt) jobs.push({ key, prompt: addBrandContext(y.thumbnailPrompt), aspectRatio: "16:9" });
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

  function handlePostingDateChange(itemId: string, date: string | null) {
    setPostingDates((prev) => {
      if (date) return { ...prev, [itemId]: date };
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  function handleRemoveItem(section: "posts" | "reels" | "linkedinArticles" | "carousels" | "quotesForX" | "youtube", index: number) {
    if (!content || !selectedCompany) return;
    const arr = content[section] as unknown[];
    if (arr.length <= 1) return; // don't remove the last item

    // Build new content with item removed
    const newArr = arr.filter((_, i) => i !== index);
    const newContent = { ...content, [section]: newArr };
    setContent(newContent);

    // Re-index images for this section
    const prefixMap: Record<string, string> = {
      posts: "post",
      reels: "reel",
      linkedinArticles: "article",
      carousels: "carousel",
      quotesForX: "quote",
      youtube: "yt",
    };
    const prefix = prefixMap[section];

    setImages((prev) => {
      const next: Record<string, string> = {};

      // Copy non-section images as-is
      for (const [k, v] of Object.entries(prev)) {
        if (section === "carousels") {
          if (!k.startsWith("carousel-")) {
            next[k] = v;
          }
        } else {
          if (!k.startsWith(`${prefix}-`)) {
            next[k] = v;
          }
        }
      }

      if (section === "carousels") {
        // Re-index carousel images: carousel-{i}-slide-{j}
        const carousels = newContent.carousels;
        let oldIdx = 0;
        for (let newIdx = 0; newIdx < carousels.length; newIdx++) {
          if (oldIdx === index) oldIdx++; // skip removed carousel
          const slides = carousels[newIdx].slides;
          for (let j = 0; j < slides.length; j++) {
            const oldKey = `carousel-${oldIdx}-slide-${j}`;
            const newKey = `carousel-${newIdx}-slide-${j}`;
            if (prev[oldKey]) next[newKey] = prev[oldKey];
          }
          oldIdx++;
        }
      } else {
        // Re-index simple images: prefix-{i}
        let oldIdx = 0;
        for (let newIdx = 0; newIdx < newArr.length; newIdx++) {
          if (oldIdx === index) oldIdx++; // skip removed item
          const oldKey = `${prefix}-${oldIdx}`;
          const newKey = `${prefix}-${newIdx}`;
          if (prev[oldKey]) next[newKey] = prev[oldKey];
          oldIdx++;
        }
      }

      // Persist re-indexed images to server only if project is saved
      if (currentSavedId) {
        fetch("/api/images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: selectedCompany.id, savedContentId: currentSavedId, images: next }),
        }).catch(() => {});
      }

      return next;
    });

    // Re-index posting dates for this section
    const datePrefixMap: Record<string, string> = {
      posts: "post",
      reels: "reel",
      linkedinArticles: "article",
      carousels: "carousel",
      quotesForX: "quote",
      youtube: "youtube",
    };
    const datePrefix = datePrefixMap[section];

    setPostingDates((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (section === "carousels") {
          if (!k.startsWith("carousel-") || k.includes("-slide-")) {
            next[k] = v;
          }
        } else {
          if (!k.startsWith(`${datePrefix}-`)) {
            next[k] = v;
          }
        }
      }
      if (section === "carousels") {
        let oldIdx = 0;
        for (let newIdx = 0; newIdx < newArr.length; newIdx++) {
          if (oldIdx === index) oldIdx++;
          const oldKey = `carousel-${oldIdx}`;
          const newKey = `carousel-${newIdx}`;
          if (prev[oldKey]) next[newKey] = prev[oldKey];
          oldIdx++;
        }
      } else {
        let oldIdx = 0;
        for (let newIdx = 0; newIdx < newArr.length; newIdx++) {
          if (oldIdx === index) oldIdx++;
          const oldKey = `${datePrefix}-${oldIdx}`;
          const newKey = `${datePrefix}-${newIdx}`;
          if (prev[oldKey]) next[newKey] = prev[oldKey];
          oldIdx++;
        }
      }
      return next;
    });
  }

  function handleDriveImport(importedImages: Record<string, string>) {
    setImages((prev) => {
      const next = { ...prev, ...importedImages };
      // Persist merged images to server only if project is saved
      if (selectedCompany && currentSavedId) {
        fetch("/api/images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId: selectedCompany.id, savedContentId: currentSavedId, images: next }),
        }).catch(() => {});
      }
      return next;
    });
    toast(`Imported ${Object.keys(importedImages).length} image(s) from Drive`, "success");
  }

  async function handleDriveAuth(code: string) {
    try {
      const res = await fetch("/api/drive/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setDriveStatus((prev) => ({ ...prev, authenticated: true, email: data.email }));
        toast(`Connected to Google Drive (${data.email})`, "success");
        return true;
      } else {
        toast(data.error || "Failed to connect to Google Drive", "error");
        return false;
      }
    } catch {
      toast("Failed to connect to Google Drive", "error");
      return false;
    }
  }

  async function handleDeleteSaved(id: string) {
    if (!selectedCompany) return;
    const res = await fetch(`/api/saved-content?companyId=${selectedCompany.id}&id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setSavedContent((prev) => prev.filter((item) => item.id !== id));
      if (currentSavedId === id) {
        setCurrentSavedId(null);
        setContent(null);
        setSelectedTheme(null);
        setImages({});
        setPostingDates({});
      }
    }
  }

  async function handleCompleteSaved(id: string) {
    if (!selectedCompany) return;
    const res = await fetch("/api/saved-content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: selectedCompany.id, id }),
    });
    if (res.ok) {
      const now = new Date().toISOString();
      setSavedContent((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: "completed" as const, completedAt: now } : item))
      );
      if (currentSavedId === id) {
        setCurrentSavedId(null);
        setContent(null);
        setSelectedTheme(null);
        setImages({});
        setPostingDates({});
      }
      toast("Project marked as completed", "success");
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
      if (currentSavedId && deletedSet.has(currentSavedId)) {
        setCurrentSavedId(null);
        setContent(null);
        setSelectedTheme(null);
        setImages({});
        setPostingDates({});
      }
    }
  }

  const handleSaveContent = useCallback(async () => {
    if (!selectedCompany || !content || !selectedTheme || !saveContentName.trim()) return;
    setSavingContent(true);
    try {
      // Include images in the save payload for new projects
      const res = await fetch("/api/saved-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          name: saveContentName.trim(),
          theme: selectedTheme,
          content,
          images: Object.keys(images).length > 0 ? images : undefined,
        }),
      });
      if (res.ok) {
        const item = await res.json();
        setSavedContent((prev) => [item, ...prev]);
        setCurrentSavedId(item.id);
        setShowSaveDialog(false);
        setSaveContentName("");
        toast("Project saved successfully", "success");
      } else {
        const data = await res.json();
        toast(data.error || "Failed to save content", "error");
      }
    } finally {
      setSavingContent(false);
    }
  }, [selectedCompany, content, selectedTheme, saveContentName, images, toast]);

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
        // Also persist current images for this project
        if (Object.keys(images).length > 0) {
          fetch("/api/images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId: selectedCompany.id, savedContentId: currentSavedId, images }),
          }).catch(() => {});
        }
        toast("Project updated successfully", "success");
      } else {
        const data = await res.json();
        toast(data.error || "Failed to update content", "error");
      }
    } finally {
      setSavingContent(false);
    }
  }, [selectedCompany, content, currentSavedId, images, toast]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!selectedCompany) return;
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

  // Brand CSS variables — apply company colors to CSS custom properties
  useEffect(() => {
    if (!selectedCompany) return;
    const { light, dark } = buildBrandCssVars(selectedCompany.brandColors, selectedCompany.fontFamily);

    // Set light-mode vars on :root
    const root = document.documentElement;
    for (const [key, val] of Object.entries(light)) {
      root.style.setProperty(key, val);
    }

    // Inject/update dark-mode overrides via <style> tag
    const styleId = "brand-dark-vars";
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    const darkCss = Object.entries(dark).map(([k, v]) => `  ${k}: ${v};`).join("\n");
    styleEl.textContent = `.dark {\n${darkCss}\n}`;

    return () => {
      for (const key of Object.keys(light)) {
        root.style.removeProperty(key);
      }
      if (styleEl) styleEl.textContent = "";
    };
  }, [selectedCompany?.brandColors, selectedCompany?.fontFamily, selectedCompany]);

  // Google Font loader
  useEffect(() => {
    const fontFamily = selectedCompany?.fontFamily;
    const linkId = "brand-google-font";
    if (!fontFamily) {
      const existing = document.getElementById(linkId);
      if (existing) existing.remove();
      return;
    }
    let link = document.getElementById(linkId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@300;400;500;600;700&display=swap`;
  }, [selectedCompany?.fontFamily]);

  // Compute header text contrast
  const headerTextLight = selectedCompany?.brandColors?.[0] ? isLightColor(selectedCompany.brandColors[0]) : false;

  if (!selectedCompany) {
    return <CompanySelector onSelect={handleSelectCompany} />;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-primary-light dark:from-slate-900 dark:to-brand-primary-light">
      <header className="bg-brand-primary">
        <div className={`max-w-4xl mx-auto px-6 py-6 ${headerTextLight ? "text-slate-900" : "text-white"}`}>
          <button
            onClick={handleBackToCompanies}
            className={`flex items-center gap-2 mb-4 transition-colors ${headerTextLight ? "text-slate-700 hover:text-slate-900" : "text-white/80 hover:text-white"}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to companies
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">{selectedCompany.name}</h1>
              <p className={`mt-1 ${headerTextLight ? "text-slate-600" : "text-white/80"}`}>Content themes from your memory - scripts, captions, articles & images</p>
            </div>
            <div className="flex items-center gap-2">
              {currentUser && (
                <span className={`text-sm hidden sm:inline ${headerTextLight ? "text-slate-600" : "text-white/80"}`}>
                  {currentUser.displayName}
                </span>
              )}
              {currentUser?.role === "admin" && (
                <Link
                  href="/admin"
                  className={`p-2 rounded-lg hover:bg-white/10 transition-colors ${headerTextLight ? "text-slate-600 hover:text-slate-900" : "text-white/80 hover:text-white"}`}
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
            {(selectedCompany.logo || (selectedCompany.brandColors && selectedCompany.brandColors.length > 0) || selectedCompany.fontFamily || characters.length > 0 || selectedCompany.slackWebhookUrl || selectedCompany.slackEditorWebhookUrl) && (
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
                  <div className="flex flex-wrap gap-3 mb-3">
                    {(selectedCompany.brandColors || []).map((color, i) => (
                      <div
                        key={i}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("brand-color-index", String(i))}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = parseInt(e.dataTransfer.getData("brand-color-index"), 10);
                          handleReorderBrandColors(from, i);
                        }}
                        className="flex flex-col items-center gap-1 cursor-grab active:cursor-grabbing"
                      >
                        <button
                          onClick={() => handleRemoveBrandColor(i)}
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
                    {(selectedCompany.brandColors || []).length < 6 && (
                      <div className="flex flex-col items-center gap-1">
                        <label className="w-9 h-9 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center cursor-pointer hover:border-brand-primary transition-colors">
                          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          <input
                            type="color"
                            className="hidden"
                            onChange={(e) => handleAddBrandColor(e.target.value)}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {(selectedCompany.brandColors || []).length}/6 colors. Drag to reorder, click to remove.
                  </p>
                </div>
              </div>

              {/* Font Family */}
              <div className="mt-6">
                <FontPicker
                  value={selectedCompany.fontFamily || ""}
                  onChange={(font) => updateCompanyBrand({ fontFamily: font })}
                />
              </div>

              {/* Slack Integration */}
              <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-4">Slack Integration</h4>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Content Schedule Webhook URL
                    </label>
                    <input
                      type="url"
                      defaultValue={selectedCompany.slackWebhookUrl || ""}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val !== (selectedCompany.slackWebhookUrl || "")) {
                          updateCompanySlack({ slackWebhookUrl: val });
                        }
                      }}
                      placeholder="https://hooks.slack.com/services/..."
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-shadow"
                    />
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      Leave blank to use system defaults.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Editor Webhook URL
                    </label>
                    <input
                      type="url"
                      defaultValue={selectedCompany.slackEditorWebhookUrl || ""}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val !== (selectedCompany.slackEditorWebhookUrl || "")) {
                          updateCompanySlack({ slackEditorWebhookUrl: val });
                        }
                      }}
                      placeholder="https://hooks.slack.com/services/..."
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-shadow"
                    />
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
                          <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Bot Token</label>
                          <input
                            type="text"
                            defaultValue={selectedCompany.slackBotToken || ""}
                            onBlur={(e) => {
                              const val = e.target.value.trim();
                              if (val !== (selectedCompany.slackBotToken || "")) {
                                updateCompanySlack({ slackBotToken: val });
                              }
                            }}
                            placeholder="xoxb-..."
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-shadow font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1">Channel ID</label>
                          <input
                            type="text"
                            defaultValue={selectedCompany.slackChannelId || ""}
                            onBlur={(e) => {
                              const val = e.target.value.trim();
                              if (val !== (selectedCompany.slackChannelId || "")) {
                                updateCompanySlack({ slackChannelId: val });
                              }
                            }}
                            placeholder="C01234ABCDE"
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-shadow font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <CharacterManager
                characters={characters}
                loading={charactersLoading}
                onAdd={handleAddCharacter}
                onUpdate={handleUpdateCharacter}
                onDelete={handleDeleteCharacter}
                onUploadImage={handleUploadCharacterImage}
                onRemoveImage={handleRemoveCharacterImage}
              />
            </div>
          )}
        </section>

        <MemoryManager companyId={selectedCompany.id} />

        {savedContent.length > 0 && (
          <section className="mb-8">
            <button
              onClick={() => setShowSavedContent(!showSavedContent)}
              className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <svg className={`w-4 h-4 transition-transform ${showSavedContent ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Saved Projects ({savedContent.filter(i => i.status !== "completed").length})
            </button>
            {showSavedContent && (
              <div className="mt-3">
                <SavedContentList
                  items={savedContent}
                  currentSavedId={currentSavedId}
                  onLoad={handleLoadProject}
                  onDelete={handleDeleteSaved}
                  onBulkDelete={handleBulkDeleteSaved}
                  onComplete={handleCompleteSaved}
                />
              </div>
            )}
          </section>
        )}

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
              <svg className="animate-spin h-5 w-5 text-brand-primary" viewBox="0 0 24 24">
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

        {!contentLoading && !content && streamingText && (
          <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-amber-300 dark:border-amber-700">
            <h2 className="text-lg font-semibold text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Content could not be processed
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
              The AI response could not be parsed. This can happen with large content batches. You can copy the raw output below or try generating again.
            </p>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => { navigator.clipboard.writeText(streamingText); toast("Copied to clipboard", "success"); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy raw output
              </button>
              <button
                onClick={() => { setStreamingText(""); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                Dismiss
              </button>
            </div>
            <pre className="text-xs text-slate-500 dark:text-slate-400 whitespace-pre-wrap max-h-96 overflow-y-auto bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 font-mono">
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
                      ? "bg-brand-primary text-white border-brand-primary shadow-md"
                      : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-brand-primary"
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
                      ? "bg-brand-primary text-white border-brand-primary shadow-md"
                      : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-brand-primary"
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
                    <ContentCalendar content={content} startDate={new Date()} companyName={selectedCompany.name} companyId={selectedCompany.id} savedContentId={currentSavedId} themeName={selectedTheme?.title || ""} images={images} postingDates={postingDates} onPostingDateChange={handlePostingDateChange} />
                  </section>
                </ErrorBoundary>
              ) : (
                <ContentResults
                  content={content}
                  onChange={setContent}
                  companyId={selectedCompany.id}
                  companyName={selectedCompany.name}
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
                  characters={characters}
                  onDeleteImage={(key) => {
                    setImages((prev) => { const next = { ...prev }; delete next[key]; return next; });
                    if (selectedCompany && currentSavedId) {
                      fetch(`/api/images?companyId=${selectedCompany.id}&savedContentId=${currentSavedId}&key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => {});
                    }
                  }}
                  onGenerateCarouselImages={generateCarouselImages}
                  onRemoveItem={handleRemoveItem}
                  driveStatus={driveStatus}
                  onDriveAuth={handleDriveAuth}
                  onDriveImport={handleDriveImport}
                  themeName={selectedTheme?.title || ""}
                  postingDates={postingDates}
                  onPostingDateChange={handlePostingDateChange}
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
