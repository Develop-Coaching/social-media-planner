"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";
import { GeneratedContent, Theme, ToneStyle } from "@/types";
import CopyButton from "@/components/ui/CopyButton";
import EditButton from "@/components/ui/EditButton";
import { useToast } from "@/components/ToastProvider";
import { ElapsedTimer } from "@/components/Skeleton";

type ContentType = "post" | "reel" | "linkedinArticle" | "carousel" | "quoteForX" | "youtube";

type SectionKey = "posts" | "reels" | "linkedinArticles" | "carousels" | "quotesForX" | "youtube";

const MAX_HISTORY = 20;

type HistoryStacks = Record<SectionKey, { undo: GeneratedContent[SectionKey][]; redo: GeneratedContent[SectionKey][] }>;

function CharCount({ text, limit, label }: { text: string; limit?: number; label?: string }) {
  const count = text.length;
  const overLimit = limit ? count > limit : false;
  const nearLimit = limit ? count > limit * 0.9 : false;
  const color = overLimit
    ? "text-red-500"
    : nearLimit
    ? "text-amber-500"
    : "text-slate-400 dark:text-slate-500";
  return (
    <span className={`text-xs ${color} tabular-nums`}>
      {label ? `${label}: ` : ""}{count.toLocaleString()}{limit ? ` / ${limit.toLocaleString()}` : ""} chars
    </span>
  );
}

function WordCount({ text, label, wpm }: { text: string; label?: string; wpm?: number }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const speakingWpm = wpm || 150;
  const minutes = words / speakingWpm;
  const timeStr = minutes < 1
    ? `~${Math.round(minutes * 60)}s`
    : `~${Math.floor(minutes)}m ${Math.round((minutes % 1) * 60)}s`;
  return (
    <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
      {label ? `${label}: ` : ""}{words.toLocaleString()} words ({timeStr} read time)
    </span>
  );
}

function RegenerateButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 font-medium transition-colors disabled:opacity-50"
    >
      <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      {loading ? "Regenerating..." : "Regenerate"}
    </button>
  );
}

function UndoRedoButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
        </svg>
        Undo
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a5 5 0 00-5 5v2m15-7l-4-4m4 4l-4 4" />
        </svg>
        Redo
      </button>
    </div>
  );
}

interface Props {
  content: GeneratedContent;
  onChange: (content: GeneratedContent) => void;
  companyId: string;
  theme: Theme;
  tone: ToneStyle;
  images: Record<string, string>;
  imageLoading: Set<string>;
  onGenerateImage: (key: string, prompt: string, aspectRatio?: string) => void;
  onGenerateAllImages: () => void;
  currentSavedId: string | null;
  savingContent: boolean;
  onSave: () => void;
  onUpdate: () => void;
  showSaveDialog: boolean;
  onShowSaveDialog: (show: boolean) => void;
  saveContentName: string;
  onSaveContentNameChange: (name: string) => void;
  onSaveContent: () => void;
  brandColors?: string[];
}

export default function ContentResults({
  content,
  onChange,
  companyId,
  theme,
  tone,
  images,
  imageLoading,
  onGenerateImage,
  onGenerateAllImages,
  currentSavedId,
  savingContent,
  onSave,
  onUpdate,
  showSaveDialog,
  onShowSaveDialog,
  saveContentName,
  onSaveContentNameChange,
  onSaveContent,
  brandColors,
}: Props) {
  const { toast } = useToast();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

  // Close fullscreen on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && fullscreenImage) setFullscreenImage(null);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [fullscreenImage]);

  // Listen for toggle-edit-mode custom event (from Cmd+E keyboard shortcut)
  useEffect(() => {
    function handleToggleEdit() {
      setEditingKey((prev) => {
        if (prev !== null) return null;
        // Enter edit mode on the first available item
        if (content.posts.length > 0) return "post-0";
        if (content.reels.length > 0) return "reel-0";
        if (content.linkedinArticles.length > 0) return "article-0";
        if (content.carousels.length > 0) return "carousel-0";
        if (content.quotesForX.length > 0) return "quote-0";
        if (content.youtube.length > 0) return "yt-0";
        return null;
      });
    }
    window.addEventListener("toggle-edit-mode", handleToggleEdit);
    return () => window.removeEventListener("toggle-edit-mode", handleToggleEdit);
  }, [content]);

  // Image regeneration feedback state
  const [imageRegenKey, setImageRegenKey] = useState<string | null>(null);
  const [imageRegenFeedback, setImageRegenFeedback] = useState("");

  // Feature 2: Image prompt editing state
  const [editingPromptKey, setEditingPromptKey] = useState<string | null>(null);
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({});

  // Feature 3: Freshly regenerated items indicator
  const [freshlyRegenerated, setFreshlyRegenerated] = useState<Set<string>>(new Set());
  const freshTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Feature 1: Undo/redo history stacks (useRef so mutations don't trigger re-renders)
  const historyRef = useRef<HistoryStacks>({
    posts: { undo: [], redo: [] },
    reels: { undo: [], redo: [] },
    linkedinArticles: { undo: [], redo: [] },
    carousels: { undo: [], redo: [] },
    quotesForX: { undo: [], redo: [] },
    youtube: { undo: [], redo: [] },
  });
  // Counter to force re-render when undo/redo stacks change
  const [, setHistoryTick] = useState(0);
  const bumpHistory = useCallback(() => setHistoryTick((t) => t + 1), []);

  // Clean up timers on unmount
  useEffect(() => {
    const timers = freshTimersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const pushUndo = useCallback((section: SectionKey, snapshot: GeneratedContent[SectionKey]) => {
    const h = historyRef.current[section];
    h.undo = [...h.undo.slice(-(MAX_HISTORY - 1)), JSON.parse(JSON.stringify(snapshot))];
    h.redo = [];
    bumpHistory();
  }, [bumpHistory]);

  const handleUndo = useCallback((section: SectionKey) => {
    const h = historyRef.current[section];
    if (h.undo.length === 0) return;
    const prev = h.undo.pop()!;
    h.redo.push(JSON.parse(JSON.stringify(content[section])));
    if (h.redo.length > MAX_HISTORY) h.redo.shift();
    onChange({ ...content, [section]: prev });
    bumpHistory();
  }, [content, onChange, bumpHistory]);

  const handleRedo = useCallback((section: SectionKey) => {
    const h = historyRef.current[section];
    if (h.redo.length === 0) return;
    const next = h.redo.pop()!;
    h.undo.push(JSON.parse(JSON.stringify(content[section])));
    if (h.undo.length > MAX_HISTORY) h.undo.shift();
    onChange({ ...content, [section]: next });
    bumpHistory();
  }, [content, onChange, bumpHistory]);

  // Track first-edit snapshots per field for debouncing
  const lastSnapshotRef = useRef<Record<string, string>>({});

  function maybePushUndo(section: SectionKey, itemKey: string) {
    const snapshotKey = `${section}-${itemKey}`;
    const currentJson = JSON.stringify(content[section]);
    if (lastSnapshotRef.current[snapshotKey] !== currentJson) {
      pushUndo(section, content[section]);
      lastSnapshotRef.current[snapshotKey] = currentJson;
    }
  }

  // Clear snapshot tracking when editing key changes
  useEffect(() => {
    lastSnapshotRef.current = {};
  }, [editingKey]);

  function markFreshlyRegenerated(key: string) {
    setFreshlyRegenerated((prev) => new Set(prev).add(key));
    if (freshTimersRef.current[key]) clearTimeout(freshTimersRef.current[key]);
    freshTimersRef.current[key] = setTimeout(() => {
      setFreshlyRegenerated((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      delete freshTimersRef.current[key];
    }, 4000);
  }

  function getEffectivePrompt(key: string, originalPrompt: string): string {
    return editedPrompts[key] !== undefined ? editedPrompts[key] : originalPrompt;
  }

  function handleTogglePromptEdit(key: string, originalPrompt: string) {
    if (editingPromptKey === key) {
      setEditingPromptKey(null);
    } else {
      setEditingPromptKey(key);
      if (editedPrompts[key] === undefined) {
        setEditedPrompts((prev) => ({ ...prev, [key]: originalPrompt }));
      }
    }
  }

  function handlePromptChange(key: string, value: string) {
    setEditedPrompts((prev) => ({ ...prev, [key]: value }));
  }

  function handleGenerateWithPrompt(key: string, originalPrompt: string, aspectRatio?: string) {
    const prompt = withBrandColors(getEffectivePrompt(key, originalPrompt));
    setEditingPromptKey(null);
    onGenerateImage(key, prompt, aspectRatio);
  }

  const pendingImageCount = (() => {
    let count = 0;
    content.posts.forEach((_, i) => { if (!images[`post-${i}`]) count++; });
    content.reels.forEach((r, i) => { if (r.imagePrompt && !images[`reel-${i}`]) count++; });
    content.linkedinArticles.forEach((_, i) => { if (!images[`article-${i}`]) count++; });
    content.carousels.forEach((c, i) => { c.slides.forEach((_, j) => { if (!images[`carousel-${i}-slide-${j}`]) count++; }); });
    content.quotesForX.forEach((_, i) => { if (!images[`quote-${i}`]) count++; });
    content.youtube.forEach((y, i) => { if (y.thumbnailPrompt && !images[`yt-${i}`]) count++; });
    return count;
  })();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function handleRegenerate(key: string, contentType: ContentType, currentItem: unknown, onReplace: (item: any) => void, section: SectionKey) {
    setRegeneratingKey(key);
    pushUndo(section, content[section]);
    try {
      const res = await fetch("/api/regenerate-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, theme, contentType, currentItem, tone }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast(data.error || "Failed to regenerate", "error");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) { toast("Streaming not supported", "error"); return; }

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      try {
        const cleaned = fullText.replace(/^```json?\s*|\s*```$/g, "").trim();
        const item = JSON.parse(cleaned);
        onReplace(item);
        markFreshlyRegenerated(key);
      } catch {
        toast("Failed to parse regenerated content", "error");
      }
    } finally {
      setRegeneratingKey(null);
    }
  }

  function updatePost(index: number, field: "title" | "caption" | "imagePrompt", value: string) {
    maybePushUndo("posts", `post-${index}-${field}`);
    const newPosts = [...content.posts];
    newPosts[index] = { ...newPosts[index], [field]: value };
    onChange({ ...content, posts: newPosts });
  }

  function updateReel(index: number, field: "script" | "imagePrompt", value: string) {
    maybePushUndo("reels", `reel-${index}-${field}`);
    const newReels = [...content.reels];
    newReels[index] = { ...newReels[index], [field]: value };
    onChange({ ...content, reels: newReels });
  }

  function updateArticle(index: number, field: "title" | "caption" | "body" | "imagePrompt", value: string) {
    maybePushUndo("linkedinArticles", `article-${index}-${field}`);
    const newArticles = [...content.linkedinArticles];
    newArticles[index] = { ...newArticles[index], [field]: value };
    onChange({ ...content, linkedinArticles: newArticles });
  }

  function updateCarousel(index: number, field: "imagePrompt", value: string) {
    maybePushUndo("carousels", `carousel-${index}-${field}`);
    const newCarousels = [...content.carousels];
    newCarousels[index] = { ...newCarousels[index], [field]: value };
    onChange({ ...content, carousels: newCarousels });
  }

  function updateCarouselSlide(carouselIndex: number, slideIndex: number, field: "title" | "body", value: string) {
    maybePushUndo("carousels", `carousel-${carouselIndex}-slide-${slideIndex}-${field}`);
    const newCarousels = [...content.carousels];
    const newSlides = [...newCarousels[carouselIndex].slides];
    newSlides[slideIndex] = { ...newSlides[slideIndex], [field]: value };
    newCarousels[carouselIndex] = { ...newCarousels[carouselIndex], slides: newSlides };
    onChange({ ...content, carousels: newCarousels });
  }

  function updateQuote(index: number, field: "quote" | "imagePrompt", value: string) {
    maybePushUndo("quotesForX", `quote-${index}-${field}`);
    const newQuotes = [...content.quotesForX];
    newQuotes[index] = { ...newQuotes[index], [field]: value };
    onChange({ ...content, quotesForX: newQuotes });
  }

  function updateYoutube(index: number, field: "title" | "script" | "thumbnailPrompt", value: string) {
    maybePushUndo("youtube", `yt-${index}-${field}`);
    const newYoutube = [...content.youtube];
    newYoutube[index] = { ...newYoutube[index], [field]: value };
    onChange({ ...content, youtube: newYoutube });
  }

  function buildPostsParagraphs(): Paragraph[] {
    if (!content.posts.length) return [];
    const children: Paragraph[] = [
      new Paragraph({ text: "Posts", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "" }),
    ];
    content.posts.forEach((p, index) => {
      children.push(
        new Paragraph({ text: `Post ${index + 1}: ${p.title}`, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "" }),
        new Paragraph({ children: [new TextRun({ text: p.caption })] }),
        new Paragraph({ text: "" }),
        new Paragraph({ children: [new TextRun({ text: "Image prompt: ", bold: true }), new TextRun({ text: p.imagePrompt, italics: true })] }),
        new Paragraph({ text: "" }),
        new Paragraph({ text: "---" }),
        new Paragraph({ text: "" }),
      );
    });
    return children;
  }

  function buildReelsParagraphs(): Paragraph[] {
    if (!content.reels.length) return [];
    const children: Paragraph[] = [
      new Paragraph({ text: "Reel Scripts", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "" }),
    ];
    content.reels.forEach((reel, index) => {
      children.push(
        new Paragraph({ text: `Reel ${index + 1}`, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "" }),
      );
      reel.script.split("\n").forEach((para) => {
        children.push(new Paragraph({ children: [new TextRun({ text: para })] }));
      });
      children.push(
        new Paragraph({ text: "" }),
        new Paragraph({ text: "---" }),
        new Paragraph({ text: "" }),
      );
    });
    return children;
  }

  function buildArticlesParagraphs(): Paragraph[] {
    if (!content.linkedinArticles.length) return [];
    const children: Paragraph[] = [
      new Paragraph({ text: "LinkedIn Articles", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "" }),
    ];
    content.linkedinArticles.forEach((article, index) => {
      children.push(
        new Paragraph({ text: `Article ${index + 1}: ${article.title}`, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "" }),
      );
      if (article.caption) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: "LinkedIn Post Caption: ", bold: true }), new TextRun({ text: article.caption })] }),
          new Paragraph({ text: "" }),
        );
      }
      article.body.split("\n").forEach((para) => {
        children.push(new Paragraph({ children: [new TextRun({ text: para })] }));
      });
      children.push(
        new Paragraph({ text: "" }),
        new Paragraph({ text: "---" }),
        new Paragraph({ text: "" }),
      );
    });
    return children;
  }

  function buildCarouselsParagraphs(): Paragraph[] {
    if (!content.carousels.length) return [];
    const children: Paragraph[] = [
      new Paragraph({ text: "Carousels", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "" }),
    ];
    content.carousels.forEach((c, index) => {
      children.push(
        new Paragraph({ text: `Carousel ${index + 1}`, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "" }),
      );
      c.slides.forEach((s, j) => {
        children.push(
          new Paragraph({ children: [new TextRun({ text: `Slide ${j + 1}: ${s.title}`, bold: true })] }),
          new Paragraph({ children: [new TextRun({ text: s.body })] }),
          new Paragraph({ text: "" }),
        );
      });
      children.push(
        new Paragraph({ text: "---" }),
        new Paragraph({ text: "" }),
      );
    });
    return children;
  }

  function buildQuotesParagraphs(): Paragraph[] {
    if (!content.quotesForX.length) return [];
    const children: Paragraph[] = [
      new Paragraph({ text: "Quotes for X", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "" }),
    ];
    content.quotesForX.forEach((q, index) => {
      children.push(
        new Paragraph({ text: `Quote ${index + 1}`, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "" }),
        new Paragraph({ children: [new TextRun({ text: `"${q.quote}"`, italics: true })] }),
        new Paragraph({ text: "" }),
        new Paragraph({ text: "---" }),
        new Paragraph({ text: "" }),
      );
    });
    return children;
  }

  function buildYoutubeParagraphs(): Paragraph[] {
    if (!content.youtube.length) return [];
    const children: Paragraph[] = [
      new Paragraph({ text: "YouTube Scripts", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "" }),
    ];
    content.youtube.forEach((y, index) => {
      children.push(
        new Paragraph({ text: `Video ${index + 1}: ${y.title}`, heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: "" }),
      );
      y.script.split("\n").forEach((para) => {
        children.push(new Paragraph({ children: [new TextRun({ text: para })] }));
      });
      children.push(
        new Paragraph({ text: "" }),
        new Paragraph({ text: "---" }),
        new Paragraph({ text: "" }),
      );
    });
    return children;
  }

  async function downloadSectionAsWord(builder: () => Paragraph[], filename: string) {
    const children = builder();
    if (!children.length) return;
    const doc = new Document({ sections: [{ properties: {}, children }] });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, filename);
  }

  async function downloadAllAsWord() {
    const children: Paragraph[] = [
      new Paragraph({ text: `Content: ${theme.title}`, heading: HeadingLevel.TITLE }),
      new Paragraph({ text: "" }),
      ...buildPostsParagraphs(),
      ...buildReelsParagraphs(),
      ...buildArticlesParagraphs(),
      ...buildCarouselsParagraphs(),
      ...buildQuotesParagraphs(),
      ...buildYoutubeParagraphs(),
    ];
    const doc = new Document({ sections: [{ properties: {}, children }] });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, `all-content-${theme.title.toLowerCase().replace(/\s+/g, "-")}.docx`);
  }

  function downloadCSV() {
    const rows: string[][] = [["Type", "Title", "Content", "Image Prompt"]];
    content.posts.forEach((p) => rows.push(["Post", p.title, p.caption, p.imagePrompt]));
    content.reels.forEach((r, i) => rows.push(["Reel", `Reel ${i + 1}`, r.script, r.imagePrompt || ""]));
    content.linkedinArticles.forEach((a) => rows.push(["LinkedIn Article", a.title, `${a.caption ? `Caption: ${a.caption}\n\n` : ""}${a.body}`, a.imagePrompt]));
    content.carousels.forEach((c, i) => {
      const slideText = c.slides.map((s, j) => `Slide ${j + 1}: ${s.title}\n${s.body}`).join("\n\n");
      rows.push(["Carousel", `Carousel ${i + 1}`, slideText, c.imagePrompt]);
    });
    content.quotesForX.forEach((q) => rows.push(["Quote (X)", q.quote, q.quote, q.imagePrompt]));
    content.youtube.forEach((y) => rows.push(["YouTube", y.title, y.script, y.thumbnailPrompt || ""]));

    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, `content-${theme.title.toLowerCase().replace(/\s+/g, "-")}.csv`);
  }

  function downloadImage(dataUrl: string, filename: string) {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.click();
  }

  function renderImageWithRegenerate(key: string, prompt: string, filename: string, aspectRatio?: string) {
    const showingFeedback = imageRegenKey === key;
    return (
      <div className="mt-3">
        <img src={images[key]} alt="" className="rounded-xl max-h-64 object-cover shadow-md cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setFullscreenImage(images[key])} />
        <div className="flex items-center gap-3 mt-2">
          <button onClick={() => downloadImage(images[key], filename)} className="text-sm text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 font-medium inline-flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Download
          </button>
          <button
            onClick={() => {
              if (showingFeedback) {
                setImageRegenKey(null);
                setImageRegenFeedback("");
              } else {
                setImageRegenKey(key);
                setImageRegenFeedback("");
              }
            }}
            disabled={imageLoading.has(key)}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 font-medium inline-flex items-center gap-1"
          >
            <svg className={`w-4 h-4 ${imageLoading.has(key) ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {imageLoading.has(key) ? "Regenerating..." : "Regenerate image"}
          </button>
        </div>
        {showingFeedback && (
          <div className="mt-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">What should be different? (optional)</label>
            <input
              type="text"
              value={imageRegenFeedback}
              onChange={(e) => setImageRegenFeedback(e.target.value)}
              placeholder="e.g. Make it brighter, less text, more minimalist..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500 mb-2"
            />
            <button
              onClick={() => {
                const feedback = imageRegenFeedback.trim();
                const basePrompt = feedback ? `${prompt}. IMPORTANT CHANGE: ${feedback}` : prompt;
                onGenerateImage(key, withBrandColors(basePrompt), aspectRatio);
                setImageRegenKey(null);
                setImageRegenFeedback("");
              }}
              className="px-4 py-1.5 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 transition-colors"
            >
              Regenerate
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderImagePromptEditor(key: string, originalPrompt: string, aspectRatio?: string) {
    const isEditingPrompt = editingPromptKey === key;
    const effectivePrompt = getEffectivePrompt(key, originalPrompt);
    const hasBeenEdited = editedPrompts[key] !== undefined && editedPrompts[key] !== originalPrompt;

    return (
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleGenerateWithPrompt(key, originalPrompt, aspectRatio)}
            disabled={imageLoading.has(key)}
            className="text-sm text-sky-600 dark:text-sky-400 font-medium hover:text-sky-800 dark:hover:text-sky-300"
          >
            {imageLoading.has(key) ? "Generating..." : "Generate image"}
          </button>
          <button
            onClick={() => handleTogglePromptEdit(key, originalPrompt)}
            title="Edit image prompt before generating"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              isEditingPrompt
                ? "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300"
                : "text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-700"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            {isEditingPrompt ? "Hide prompt" : "Edit prompt"}
            {hasBeenEdited && (
              <span className="ml-1 w-1.5 h-1.5 rounded-full bg-sky-500 inline-block" />
            )}
          </button>
        </div>
        {isEditingPrompt && (
          <div className="mt-2 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Image prompt (edit before generating):</label>
            <textarea
              value={effectivePrompt}
              onChange={(e) => handlePromptChange(key, e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500"
            />
            {hasBeenEdited && (
              <button
                onClick={() => setEditedPrompts((prev) => { const next = { ...prev }; delete next[key]; return next; })}
                className="mt-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              >
                Reset to original
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  function buildCarouselSlidePrompt(carousel: GeneratedContent["carousels"][number], slideIndex: number): string {
    const s = carousel.slides[slideIndex];
    const allTitles = carousel.slides.map((sl, idx) => `${idx + 1}. ${sl.title}`).join("; ");
    return `Create a social media carousel slide image. Overall carousel topic with ${carousel.slides.length} slides: [${allTitles}]. This slide (${slideIndex + 1} of ${carousel.slides.length}): "${s.title} - ${s.body}". Visual style for ALL slides: ${carousel.imagePrompt}. IMPORTANT: Use a consistent layout, typography, illustration style, and color scheme that would look unified across all slides in this carousel.`;
  }

  function withBrandColors(prompt: string): string {
    if (brandColors && brandColors.length > 0) {
      return `${prompt}. Use these brand colors: ${brandColors.join(", ")}`;
    }
    return prompt;
  }

  function freshClass(key: string): string {
    return freshlyRegenerated.has(key)
      ? "ring-2 ring-green-400 dark:ring-green-500 animate-pulse-once"
      : "";
  }

  function renderFreshBadge(key: string) {
    if (!freshlyRegenerated.has(key)) return null;
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
        Regenerated
      </span>
    );
  }

  return (
    <section className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
      <style>{`
        @keyframes pulse-once {
          0% { background-color: rgba(74, 222, 128, 0.15); }
          100% { background-color: transparent; }
        }
        .animate-pulse-once {
          animation: pulse-once 2s ease-out forwards;
        }
      `}</style>

      {/* Fullscreen image overlay */}
      {fullscreenImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setFullscreenImage(null)}
        >
          <button
            onClick={() => setFullscreenImage(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={fullscreenImage}
            alt=""
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400 text-sm font-bold">4</span>
          Your content
          {currentSavedId && (
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400">(saved)</span>
          )}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {pendingImageCount > 0 && (
            <button
              onClick={onGenerateAllImages}
              disabled={imageLoading.size > 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 text-white font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors text-sm"
            >
              <svg className={`w-4 h-4 ${imageLoading.size > 0 ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {imageLoading.size > 0 ? `Generating ${imageLoading.size} image${imageLoading.size > 1 ? "s" : ""}...` : `Generate all images (${pendingImageCount})`}
            </button>
          )}
          {imageLoading.size > 0 && <ElapsedTimer />}
          <button
            onClick={downloadAllAsWord}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Word
          </button>
          <button
            onClick={downloadCSV}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            CSV
          </button>
          {currentSavedId ? (
            <button
              onClick={onUpdate}
              disabled={savingContent}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50 transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {savingContent ? "Saving..." : "Update Saved"}
            </button>
          ) : (
            <button
              onClick={() => onShowSaveDialog(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              Save
            </button>
          )}
        </div>
      </div>

      {showSaveDialog && (
        <div className="mb-6 p-4 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800">
          <h3 className="font-medium text-slate-800 dark:text-slate-200 mb-3">Save this content</h3>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Name (e.g. Week 1 Content)"
              value={saveContentName}
              onChange={(e) => onSaveContentNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSaveContent()}
              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-sky-500"
            />
            <button
              onClick={onSaveContent}
              disabled={savingContent || !saveContentName.trim()}
              className="px-4 py-2 rounded-lg bg-sky-600 text-white font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {savingContent ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => onShowSaveDialog(false)}
              className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Posts */}
      {content.posts.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 text-lg">Posts</h3>
              <UndoRedoButtons
                canUndo={historyRef.current.posts.undo.length > 0}
                canRedo={historyRef.current.posts.redo.length > 0}
                onUndo={() => handleUndo("posts")}
                onRedo={() => handleRedo("posts")}
              />
            </div>
            <button onClick={() => downloadSectionAsWord(buildPostsParagraphs, "posts.docx")} className="text-sm text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 font-medium">
              Download as Word
            </button>
          </div>
          {content.posts.map((p, i) => {
            const key = `post-${i}`;
            const isEditing = editingKey === key;
            const isFresh = freshlyRegenerated.has(key);
            return (
              <div key={i} className={`mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 transition-all ${freshClass(key)}`}>
                <div className="flex items-center justify-between mb-3">
                  {renderFreshBadge(key)}
                  <div className={`flex items-center gap-3 ${isFresh ? "" : "ml-auto"}`}>
                    <RegenerateButton loading={regeneratingKey === key} onClick={() => handleRegenerate(key, "post", p, (item) => { const newPosts = [...content.posts]; newPosts[i] = item; onChange({ ...content, posts: newPosts }); }, "posts")} />
                    <CopyButton text={p.caption} label="Copy caption" />
                    <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                  </div>
                </div>
                {isEditing ? (
                  <>
                    <label className="block text-xs text-slate-500 mb-1">Title:</label>
                    <input type="text" value={p.title} onChange={(e) => updatePost(i, "title", e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 font-semibold focus:ring-2 focus:ring-sky-500" />
                    <label className="block text-xs text-slate-500 mb-1">Caption:</label>
                    <textarea value={p.caption} onChange={(e) => updatePost(i, "caption", e.target.value)} rows={6} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 focus:ring-2 focus:ring-sky-500" />
                    <div className="flex gap-3 mb-3"><CharCount text={p.caption} limit={2200} label="IG" /> <CharCount text={p.caption} limit={3000} label="LinkedIn" /></div>
                    <label className="block text-xs text-slate-500 mb-1">Image prompt:</label>
                    <textarea value={p.imagePrompt} onChange={(e) => updatePost(i, "imagePrompt", e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500" />
                  </>
                ) : (
                  <>
                    <h4 className="font-semibold text-sky-600 dark:text-sky-400 mb-2">{p.title}</h4>
                    <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{p.caption}</p>
                    <div className="flex gap-3 mt-1"><CharCount text={p.caption} limit={2200} label="IG" /> <CharCount text={p.caption} limit={3000} label="LinkedIn" /></div>
                    <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Image prompt: {p.imagePrompt}</p>
                  </>
                )}
                {images[key] ? (
                  renderImageWithRegenerate(key, p.imagePrompt, `post-${i + 1}.png`)
                ) : (
                  renderImagePromptEditor(key, p.imagePrompt)
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reels */}
      {content.reels.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 text-lg">Reels</h3>
              <UndoRedoButtons
                canUndo={historyRef.current.reels.undo.length > 0}
                canRedo={historyRef.current.reels.redo.length > 0}
                onUndo={() => handleUndo("reels")}
                onRedo={() => handleRedo("reels")}
              />
            </div>
            <button onClick={() => downloadSectionAsWord(buildReelsParagraphs, "reel-scripts.docx")} className="text-sm text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 font-medium">
              Download as Word
            </button>
          </div>
          {content.reels.map((r, i) => {
            const key = `reel-${i}`;
            const isEditing = editingKey === key;
            const isFresh = freshlyRegenerated.has(key);
            return (
              <div key={i} className={`mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 transition-all ${freshClass(key)}`}>
                <div className="flex items-center justify-between mb-3">
                  {renderFreshBadge(key)}
                  <div className={`flex items-center gap-3 ${isFresh ? "" : "ml-auto"}`}>
                    <RegenerateButton loading={regeneratingKey === key} onClick={() => handleRegenerate(key, "reel", r, (item) => { const newReels = [...content.reels]; newReels[i] = item; onChange({ ...content, reels: newReels }); }, "reels")} />
                    <CopyButton text={r.script} label="Copy script" />
                    <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                  </div>
                </div>
                {isEditing ? (
                  <>
                    <textarea value={r.script} onChange={(e) => updateReel(i, "script", e.target.value)} rows={8} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 focus:ring-2 focus:ring-sky-500" />
                    <div className="mb-3"><WordCount text={r.script} label="Script" /></div>
                    {r.imagePrompt !== undefined && (
                      <>
                        <label className="block text-xs text-slate-500 mb-1">Thumbnail prompt:</label>
                        <textarea value={r.imagePrompt || ""} onChange={(e) => updateReel(i, "imagePrompt", e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500" />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{r.script}</p>
                    <div className="mt-1"><WordCount text={r.script} label="Script" /></div>
                    {r.imagePrompt && <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Thumbnail: {r.imagePrompt}</p>}
                  </>
                )}
                {r.imagePrompt && (
                  <>
                    {!images[key] ? (
                      renderImagePromptEditor(key, r.imagePrompt, "9:16")
                    ) : (
                      renderImageWithRegenerate(key, r.imagePrompt, `reel-${i + 1}-thumbnail.png`, "9:16")
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* LinkedIn Articles */}
      {content.linkedinArticles.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 text-lg">LinkedIn articles</h3>
              <UndoRedoButtons
                canUndo={historyRef.current.linkedinArticles.undo.length > 0}
                canRedo={historyRef.current.linkedinArticles.redo.length > 0}
                onUndo={() => handleUndo("linkedinArticles")}
                onRedo={() => handleRedo("linkedinArticles")}
              />
            </div>
            <button onClick={() => downloadSectionAsWord(buildArticlesParagraphs, "linkedin-articles.docx")} className="text-sm text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 font-medium">
              Download as Word
            </button>
          </div>
          {content.linkedinArticles.map((a, i) => {
            const key = `article-${i}`;
            const isEditing = editingKey === key;
            const isFresh = freshlyRegenerated.has(key);
            return (
              <div key={i} className={`mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 transition-all ${freshClass(key)}`}>
                <div className="flex items-center justify-between mb-3">
                  {renderFreshBadge(key)}
                  <div className={`flex items-center gap-3 ${isFresh ? "" : "ml-auto"}`}>
                    <RegenerateButton loading={regeneratingKey === key} onClick={() => handleRegenerate(key, "linkedinArticle", a, (item) => { const newArticles = [...content.linkedinArticles]; newArticles[i] = item; onChange({ ...content, linkedinArticles: newArticles }); }, "linkedinArticles")} />
                    <CopyButton text={`${a.title}\n\n${a.caption ? `Caption: ${a.caption}\n\n` : ""}${a.body}`} label="Copy article" />
                    <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                  </div>
                </div>
                {isEditing ? (
                  <>
                    <label className="block text-xs text-slate-500 mb-1">Title:</label>
                    <input type="text" value={a.title} onChange={(e) => updateArticle(i, "title", e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 font-semibold focus:ring-2 focus:ring-sky-500" />
                    <label className="block text-xs text-slate-500 mb-1">LinkedIn post caption (teaser):</label>
                    <textarea value={a.caption} onChange={(e) => updateArticle(i, "caption", e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 text-sm focus:ring-2 focus:ring-sky-500" />
                    <div className="mb-3"><CharCount text={a.caption} limit={3000} label="LinkedIn" /></div>
                    <label className="block text-xs text-slate-500 mb-1">Article body:</label>
                    <textarea value={a.body} onChange={(e) => updateArticle(i, "body", e.target.value)} rows={12} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 text-sm focus:ring-2 focus:ring-sky-500" />
                    <div className="mb-3"><WordCount text={a.body} label="Article" /></div>
                    <label className="block text-xs text-slate-500 mb-1">Hero image prompt:</label>
                    <textarea value={a.imagePrompt} onChange={(e) => updateArticle(i, "imagePrompt", e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500" />
                  </>
                ) : (
                  <>
                    <h4 className="font-semibold text-slate-900 dark:text-white text-lg">{a.title}</h4>
                    {a.caption && (
                      <div className="mt-2 p-3 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800">
                        <p className="text-xs text-sky-600 dark:text-sky-400 font-medium mb-1">LinkedIn post caption:</p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">{a.caption}</p>
                      </div>
                    )}
                    <p className="text-slate-700 dark:text-slate-300 mt-3 whitespace-pre-wrap text-sm">{a.body}</p>
                    <div className="mt-1"><WordCount text={a.body} label="Article" /></div>
                    <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Hero image: {a.imagePrompt}</p>
                  </>
                )}
                {images[key] ? (
                  renderImageWithRegenerate(key, a.imagePrompt, `article-${i + 1}-hero.png`, "16:9")
                ) : (
                  renderImagePromptEditor(key, a.imagePrompt, "16:9")
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Carousels */}
      {content.carousels.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 text-lg">Carousels</h3>
              <UndoRedoButtons
                canUndo={historyRef.current.carousels.undo.length > 0}
                canRedo={historyRef.current.carousels.redo.length > 0}
                onUndo={() => handleUndo("carousels")}
                onRedo={() => handleRedo("carousels")}
              />
            </div>
            <button onClick={() => downloadSectionAsWord(buildCarouselsParagraphs, "carousels.docx")} className="text-sm text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 font-medium">
              Download as Word
            </button>
          </div>
          {content.carousels.map((c, i) => {
            const key = `carousel-${i}`;
            const isEditing = editingKey === key;
            const carouselText = c.slides.map((s, j) => `Slide ${j + 1}: ${s.title}\n${s.body}`).join("\n\n");
            const isFresh = freshlyRegenerated.has(key);
            return (
              <div key={i} className={`mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 transition-all ${freshClass(key)}`}>
                <div className="flex items-center justify-between mb-3">
                  {renderFreshBadge(key)}
                  <div className={`flex items-center gap-3 ${isFresh ? "" : "ml-auto"}`}>
                    <RegenerateButton loading={regeneratingKey === key} onClick={() => handleRegenerate(key, "carousel", c, (item) => { const newCarousels = [...content.carousels]; newCarousels[i] = item; onChange({ ...content, carousels: newCarousels }); }, "carousels")} />
                    <CopyButton text={carouselText} label="Copy slides" />
                    <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                  </div>
                </div>
                {isEditing ? (
                  <>
                    {c.slides.map((s, j) => (
                      <div key={j} className="mb-4 pb-4 border-b border-slate-200 dark:border-slate-700 last:border-0">
                        <label className="block text-xs text-slate-500 mb-1">Slide {j + 1} title:</label>
                        <input type="text" value={s.title} onChange={(e) => updateCarouselSlide(i, j, "title", e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-2 font-semibold focus:ring-2 focus:ring-sky-500" />
                        <label className="block text-xs text-slate-500 mb-1">Slide {j + 1} body:</label>
                        <textarea value={s.body} onChange={(e) => updateCarouselSlide(i, j, "body", e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500" />
                      </div>
                    ))}
                    <label className="block text-xs text-slate-500 mb-1">Image style prompt:</label>
                    <textarea value={c.imagePrompt} onChange={(e) => updateCarousel(i, "imagePrompt", e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500" />
                  </>
                ) : (
                  <>
                    {c.slides.map((s, j) => {
                      const slideKey = `carousel-${i}-slide-${j}`;
                      return (
                        <div key={j} className="mb-4 pb-4 border-b border-slate-200 dark:border-slate-700 last:border-0 last:pb-0 last:mb-0">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{s.title}</span>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{s.body}</p>
                          {images[slideKey] ? (
                            renderImageWithRegenerate(slideKey, buildCarouselSlidePrompt(c, j), `carousel-${i + 1}-slide-${j + 1}.png`, "1:1")
                          ) : (
                            <div className="mt-2">
                              {imageLoading.has(slideKey) ? (
                                <div className="flex items-center gap-2 text-sm text-slate-500">
                                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                                  Generating...
                                </div>
                              ) : (
                                <button onClick={() => onGenerateImage(slideKey, withBrandColors(buildCarouselSlidePrompt(c, j)), "1:1")} className="text-sm text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 font-medium">
                                  Generate slide image
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Style: {c.imagePrompt}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Quotes for X */}
      {content.quotesForX.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 text-lg">Quotes for X</h3>
              <UndoRedoButtons
                canUndo={historyRef.current.quotesForX.undo.length > 0}
                canRedo={historyRef.current.quotesForX.redo.length > 0}
                onUndo={() => handleUndo("quotesForX")}
                onRedo={() => handleRedo("quotesForX")}
              />
            </div>
            <button onClick={() => downloadSectionAsWord(buildQuotesParagraphs, "quotes-for-x.docx")} className="text-sm text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 font-medium">
              Download as Word
            </button>
          </div>
          {content.quotesForX.map((q, i) => {
            const key = `quote-${i}`;
            const isEditing = editingKey === key;
            const isFresh = freshlyRegenerated.has(key);
            return (
              <div key={i} className={`mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 transition-all ${freshClass(key)}`}>
                <div className="flex items-center justify-between mb-3">
                  {renderFreshBadge(key)}
                  <div className={`flex items-center gap-3 ${isFresh ? "" : "ml-auto"}`}>
                    <RegenerateButton loading={regeneratingKey === key} onClick={() => handleRegenerate(key, "quoteForX", q, (item) => { const newQuotes = [...content.quotesForX]; newQuotes[i] = item; onChange({ ...content, quotesForX: newQuotes }); }, "quotesForX")} />
                    <CopyButton text={q.quote} label="Copy quote" />
                    <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                  </div>
                </div>
                {isEditing ? (
                  <>
                    <textarea value={q.quote} onChange={(e) => updateQuote(i, "quote", e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 focus:ring-2 focus:ring-sky-500" />
                    <div className="mb-3"><CharCount text={q.quote} limit={280} label="X" /></div>
                    <label className="block text-xs text-slate-500 mb-1">Quote card prompt:</label>
                    <textarea value={q.imagePrompt} onChange={(e) => updateQuote(i, "imagePrompt", e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500" />
                  </>
                ) : (
                  <>
                    <blockquote className="text-slate-800 dark:text-slate-200 text-lg italic">&ldquo;{q.quote}&rdquo;</blockquote>
                    <div className="mt-1"><CharCount text={q.quote} limit={280} label="X" /></div>
                    <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Card: {q.imagePrompt}</p>
                  </>
                )}
                {images[key] ? (
                  renderImageWithRegenerate(key, q.imagePrompt, `quote-${i + 1}.png`, "1:1")
                ) : (
                  renderImagePromptEditor(key, q.imagePrompt, "1:1")
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* YouTube */}
      {content.youtube.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 text-lg">YouTube</h3>
              <UndoRedoButtons
                canUndo={historyRef.current.youtube.undo.length > 0}
                canRedo={historyRef.current.youtube.redo.length > 0}
                onUndo={() => handleUndo("youtube")}
                onRedo={() => handleRedo("youtube")}
              />
            </div>
            <button onClick={() => downloadSectionAsWord(buildYoutubeParagraphs, "youtube-scripts.docx")} className="text-sm text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 font-medium">
              Download as Word
            </button>
          </div>
          {content.youtube.map((y, i) => {
            const key = `yt-${i}`;
            const isEditing = editingKey === key;
            const isFresh = freshlyRegenerated.has(key);
            return (
              <div key={i} className={`mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 transition-all ${freshClass(key)}`}>
                <div className="flex items-center justify-between mb-3">
                  {renderFreshBadge(key)}
                  <div className={`flex items-center gap-3 ${isFresh ? "" : "ml-auto"}`}>
                    <RegenerateButton loading={regeneratingKey === key} onClick={() => handleRegenerate(key, "youtube", y, (item) => { const newYt = [...content.youtube]; newYt[i] = item; onChange({ ...content, youtube: newYt }); }, "youtube")} />
                    <CopyButton text={`${y.title}\n\n${y.script}`} label="Copy script" />
                    <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                  </div>
                </div>
                {isEditing ? (
                  <>
                    <input type="text" value={y.title} onChange={(e) => updateYoutube(i, "title", e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 font-semibold focus:ring-2 focus:ring-sky-500" />
                    <textarea value={y.script} onChange={(e) => updateYoutube(i, "script", e.target.value)} rows={12} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 text-sm focus:ring-2 focus:ring-sky-500" />
                    <div className="mb-3"><WordCount text={y.script} label="Script" /></div>
                    {y.thumbnailPrompt !== undefined && (
                      <>
                        <label className="block text-xs text-slate-500 mb-1">Thumbnail prompt:</label>
                        <textarea value={y.thumbnailPrompt || ""} onChange={(e) => updateYoutube(i, "thumbnailPrompt", e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500" />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <h4 className="font-semibold text-slate-900 dark:text-white text-lg">{y.title}</h4>
                    <p className="text-slate-700 dark:text-slate-300 mt-3 whitespace-pre-wrap text-sm">{y.script}</p>
                    <div className="mt-1"><WordCount text={y.script} label="Script" /></div>
                    {y.thumbnailPrompt && <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Thumbnail: {y.thumbnailPrompt}</p>}
                  </>
                )}
                {y.thumbnailPrompt && (
                  <>
                    {!images[key] ? (
                      renderImagePromptEditor(key, y.thumbnailPrompt, "16:9")
                    ) : (
                      renderImageWithRegenerate(key, y.thumbnailPrompt, `youtube-${i + 1}-thumbnail.png`, "16:9")
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
