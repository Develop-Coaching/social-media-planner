"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";
import { GeneratedContent, Theme, ToneStyle, LanguageOption } from "@/types";
import CopyButton from "@/components/ui/CopyButton";
import EditButton from "@/components/ui/EditButton";
import { useToast } from "@/components/ToastProvider";
import { ElapsedTimer } from "@/components/Skeleton";
import DriveImportModal from "@/components/DriveImportModal";

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

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Remove this item"
      className="inline-flex items-center gap-1 text-sm text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 font-medium transition-colors"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      Remove
    </button>
  );
}

function PostingDatePicker({ itemId, date, onChange }: { itemId: string; date?: string; onChange?: (itemId: string, date: string | null) => void }) {
  if (!onChange) return null;
  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
      <svg className="w-4 h-4 text-slate-400 dark:text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <input
        type="date"
        value={date || ""}
        onChange={(e) => onChange(itemId, e.target.value || null)}
        className="text-sm bg-transparent border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-1 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-sky-500 focus:border-transparent"
      />
      {date && (
        <button
          onClick={() => onChange(itemId, null)}
          className="text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          title="Clear date"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      {!date && (
        <span className="text-xs text-slate-400 dark:text-slate-500">No posting date</span>
      )}
    </div>
  );
}

interface Props {
  content: GeneratedContent;
  onChange: (content: GeneratedContent) => void;
  companyId: string;
  companyName: string;
  theme: Theme;
  tone: ToneStyle;
  language: LanguageOption;
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
  character?: string;
  onDeleteImage: (key: string) => void;
  onGenerateCarouselImages: (carouselIndex: number) => void;
  onRemoveItem: (section: "posts" | "reels" | "linkedinArticles" | "carousels" | "quotesForX" | "youtube", index: number) => void;
  driveStatus?: { enabled: boolean; authenticated: boolean; email?: string; clientId?: string };
  onDriveAuth?: (code: string) => Promise<boolean>;
  onDriveImport?: (importedImages: Record<string, string>) => void;
  themeName?: string;
  postingDates?: Record<string, string>;
  onPostingDateChange?: (itemId: string, date: string | null) => void;
}

export default function ContentResults({
  content,
  onChange,
  companyId,
  companyName,
  theme,
  tone,
  language,
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
  character,
  onDeleteImage,
  onGenerateCarouselImages,
  onRemoveItem,
  driveStatus,
  onDriveAuth,
  onDriveImport,
  themeName,
  postingDates = {},
  onPostingDateChange,
}: Props) {
  const { toast } = useToast();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [slackSending, setSlackSending] = useState(false);

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

  // Prompt regeneration loading state
  const [regeneratingPromptKey, setRegeneratingPromptKey] = useState<string | null>(null);

  // Add item loading state
  const [addingItemType, setAddingItemType] = useState<ContentType | null>(null);

  // Drive integration state
  const [driveSavingKey, setDriveSavingKey] = useState<string | null>(null);
  const [showDriveImport, setShowDriveImport] = useState(false);
  const googleCodeClientRef = useRef<{ requestCode: () => void } | null>(null);
  const pendingDriveUploadRef = useRef<string | null>(null);

  // Send to Editor state
  const [sentToEditor, setSentToEditor] = useState<Set<string>>(new Set());
  const [sendingToEditor, setSendingToEditor] = useState<Set<string>>(new Set());

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

  // Initialize Google Identity Services code client for Drive OAuth
  useEffect(() => {
    if (!driveStatus?.enabled || !driveStatus.clientId) return;
    const clientId = driveStatus.clientId;

    function tryInit() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).google;
      if (!g?.accounts?.oauth2?.initCodeClient) return false;

      googleCodeClientRef.current = g.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
        ux_mode: "popup",
        callback: async (response: { code?: string; error?: string }) => {
          if (response.error || !response.code) return;
          if (onDriveAuth) {
            const ok = await onDriveAuth(response.code);
            // If auth succeeded and we had a pending upload, do it now
            if (ok && pendingDriveUploadRef.current) {
              const key = pendingDriveUploadRef.current;
              pendingDriveUploadRef.current = null;
              handleDriveSave(key);
            }
          }
        },
      });
      return true;
    }

    if (tryInit()) return;

    // GIS script might not be loaded yet; poll briefly
    const interval = setInterval(() => {
      if (tryInit()) clearInterval(interval);
    }, 300);
    const timeout = setTimeout(() => clearInterval(interval), 10000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveStatus?.enabled, driveStatus?.clientId]);

  const pushUndo = useCallback((section: SectionKey, snapshot: GeneratedContent[SectionKey]) => {
    const h = historyRef.current[section];
    h.undo = [...h.undo.slice(-(MAX_HISTORY - 1)), structuredClone(snapshot)];
    h.redo = [];
    bumpHistory();
  }, [bumpHistory]);

  const handleUndo = useCallback((section: SectionKey) => {
    const h = historyRef.current[section];
    if (h.undo.length === 0) return;
    const prev = h.undo.pop()!;
    h.redo.push(structuredClone(content[section]));
    if (h.redo.length > MAX_HISTORY) h.redo.shift();
    onChange({ ...content, [section]: prev });
    bumpHistory();
  }, [content, onChange, bumpHistory]);

  const handleRedo = useCallback((section: SectionKey) => {
    const h = historyRef.current[section];
    if (h.redo.length === 0) return;
    const next = h.redo.pop()!;
    h.undo.push(structuredClone(content[section]));
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

  const pendingImageCount = useMemo(() => {
    let count = 0;
    content.posts.forEach((_, i) => { if (!images[`post-${i}`]) count++; });
    content.linkedinArticles.forEach((_, i) => { if (!images[`article-${i}`]) count++; });
    content.carousels.forEach((c, i) => { c.slides.forEach((_, j) => { if (!images[`carousel-${i}-slide-${j}`]) count++; }); });
    content.quotesForX.forEach((_, i) => { if (!images[`quote-${i}`]) count++; });
    content.youtube.forEach((y, i) => { if (y.thumbnailPrompt && !images[`yt-${i}`]) count++; });
    return count;
  }, [content, images]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function handleRegenerate(key: string, contentType: ContentType, currentItem: unknown, onReplace: (item: any) => void, section: SectionKey) {
    setRegeneratingKey(key);
    pushUndo(section, content[section]);
    try {
      const res = await fetch("/api/regenerate-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, theme, contentType, currentItem, tone, language }),
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

  async function handleAddItem(contentType: ContentType, section: SectionKey) {
    setAddingItemType(contentType);
    pushUndo(section, content[section]);
    try {
      const res = await fetch("/api/regenerate-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, theme, contentType, currentItem: null, tone, language }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast(data.error || "Failed to add item", "error");
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newArray = [...(content[section] as any[]), item];
        onChange({ ...content, [section]: newArray });
        const newKey = `${contentType === "quoteForX" ? "quote" : contentType === "linkedinArticle" ? "article" : contentType === "youtube" ? "yt" : contentType}-${newArray.length - 1}`;
        markFreshlyRegenerated(newKey);
        toast("New item added", "success");
      } catch {
        toast("Failed to parse new content", "error");
      }
    } finally {
      setAddingItemType(null);
    }
  }

  function renderAddButton(contentType: ContentType, section: SectionKey, label: string) {
    const isAdding = addingItemType === contentType;
    return (
      <button
        onClick={() => handleAddItem(contentType, section)}
        disabled={isAdding || addingItemType !== null}
        className="mt-2 w-full py-3 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-sky-400 dark:hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400 font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
      >
        {isAdding ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
            Adding {label}...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add {label}
          </>
        )}
      </button>
    );
  }

  async function handleSendToEditor(reelIndex: number) {
    const key = `reel-${reelIndex}`;
    if (sentToEditor.has(key) || sendingToEditor.has(key)) return;

    setSendingToEditor(prev => new Set(prev).add(key));
    try {
      const reel = content.reels[reelIndex];
      const res = await fetch("/api/send-to-editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          companyId,
          themeName: theme.title,
          reelIndex,
          script: reel.script,
          caption: reel.caption || "",
        }),
      });
      const data = await res.json();

      if (data.ok) {
        setSentToEditor(prev => new Set(prev).add(key));
        const parts: string[] = [];
        if (data.slack?.ok) parts.push("Slack");
        if (data.asana?.ok) parts.push("Asana");
        toast(`Sent to editor via ${parts.join(" & ")}`, "success");
      } else {
        const errors: string[] = [];
        if (data.slack?.error) errors.push(`Slack: ${data.slack.error}`);
        if (data.asana?.error) errors.push(`Asana: ${data.asana.error}`);
        toast(errors.join(". ") || "Failed to send to editor", "error");
      }
    } catch {
      toast("Network error sending to editor", "error");
    } finally {
      setSendingToEditor(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function updatePost(index: number, field: "title" | "caption" | "imagePrompt", value: string) {
    maybePushUndo("posts", `post-${index}-${field}`);
    const newPosts = [...content.posts];
    newPosts[index] = { ...newPosts[index], [field]: value };
    onChange({ ...content, posts: newPosts });
  }

  function updateReel(index: number, field: "script" | "caption", value: string) {
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

  function updateCarousel(index: number, field: "imagePrompt" | "caption", value: string) {
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
      if (reel.caption) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: "Caption: ", bold: true }), new TextRun({ text: reel.caption })] }),
          new Paragraph({ text: "" }),
        );
      }
      children.push(
        new Paragraph({ children: [new TextRun({ text: "Script:", bold: true })] }),
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
      if (c.caption) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: "Caption:", bold: true })] }),
          new Paragraph({ children: [new TextRun({ text: c.caption })] }),
          new Paragraph({ text: "" }),
        );
      }
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

  async function handleSendToSlack() {
    setSlackSending(true);
    try {
      const items: { type: string; title: string; preview: string; imageKey?: string }[] = [];
      content.posts.forEach((p, i) => items.push({ type: "Post", title: p.title, preview: p.caption.slice(0, 150), imageKey: `post-${i}` }));
      content.reels.forEach((r, i) => items.push({ type: "Reel", title: `Reel ${i + 1}`, preview: (r.caption || r.script).slice(0, 150) }));
      content.linkedinArticles.forEach((a, i) => items.push({ type: "Article", title: a.title, preview: (a.caption || a.body).slice(0, 150), imageKey: `article-${i}` }));
      content.carousels.forEach((c, i) => items.push({ type: "Carousel", title: c.slides[0]?.title || `Carousel ${i + 1}`, preview: c.slides.map(s => s.title).join(" / "), imageKey: `carousel-${i}` }));
      content.quotesForX.forEach((q, i) => items.push({ type: "Quote (X)", title: q.quote.slice(0, 40), preview: q.quote, imageKey: `quote-${i}` }));
      content.youtube.forEach((y, i) => items.push({ type: "YouTube", title: y.title, preview: y.script.slice(0, 150), imageKey: `youtube-${i}` }));

      const days = [{ dayName: "All Content", date: "", items: items.map(item => ({ time: "", ...item })) }];

      const res = await fetch("/api/notify-slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, companyId, themeName: themeName || theme.title, weekLabel: "", days }),
      });
      const data = await res.json();
      if (res.ok) {
        toast(`Sent to Slack${data.imagesUploaded ? ` with ${data.imagesUploaded} image(s)` : ""}`, "success");
      } else {
        toast(data.error || "Failed to send to Slack", "error");
      }
    } catch {
      toast("Network error sending to Slack", "error");
    } finally {
      setSlackSending(false);
    }
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
    content.reels.forEach((r, i) => rows.push(["Reel", `Reel ${i + 1}`, `${r.caption ? `Caption: ${r.caption}\n\n` : ""}Script: ${r.script}`, ""]));
    content.linkedinArticles.forEach((a) => rows.push(["LinkedIn Article", a.title, `${a.caption ? `Caption: ${a.caption}\n\n` : ""}${a.body}`, a.imagePrompt]));
    content.carousels.forEach((c, i) => {
      const slideText = (c.caption ? `Caption: ${c.caption}\n\n` : "") + c.slides.map((s, j) => `Slide ${j + 1}: ${s.title}\n${s.body}`).join("\n\n");
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

  async function handleDriveSave(key: string) {
    if (!driveStatus?.enabled) return;

    // If not authenticated, trigger popup and save the key for later
    if (!driveStatus.authenticated) {
      pendingDriveUploadRef.current = key;
      googleCodeClientRef.current?.requestCode();
      return;
    }

    setDriveSavingKey(key);
    try {
      const res = await fetch("/api/drive/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          companyName,
          folderName: theme.title,
          imageKey: key,
          fileName: `${key}.png`,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast("Saved to Google Drive", "success");
      } else if (data.error === "not_authenticated") {
        // Token expired — trigger re-auth
        pendingDriveUploadRef.current = key;
        googleCodeClientRef.current?.requestCode();
      } else {
        toast(data.error || "Failed to save to Drive", "error");
      }
    } catch {
      toast("Failed to save to Drive", "error");
    } finally {
      setDriveSavingKey(null);
    }
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
          <button
            onClick={() => onDeleteImage(key)}
            className="text-sm text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 font-medium inline-flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
          {driveStatus?.enabled && (
            <button
              onClick={() => handleDriveSave(key)}
              disabled={driveSavingKey === key}
              className="text-sm text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-300 font-medium inline-flex items-center gap-1 disabled:opacity-50"
            >
              <svg className={`w-4 h-4 ${driveSavingKey === key ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.71 3.5L1.15 15l2.16 3.75h4.73L4.46 12.5l2.17-3.75L7.71 3.5zm4.5 0L5.62 15l2.17 3.75h4.32l2.17-3.75L7.71 3.5h4.5zm4.5 0L10.12 15l2.17 3.75h4.32l6.56-11.5L20.71 3.5h-4z" />
              </svg>
              {driveSavingKey === key ? "Saving..." : "Save to Drive"}
            </button>
          )}
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
                onGenerateImage(key, withBrandContext(basePrompt), aspectRatio);
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

  async function handleRegeneratePrompt(key: string, contentType: string, contentText: string, onPromptChange: (value: string) => void) {
    setRegeneratingPromptKey(key);
    try {
      const res = await fetch("/api/regenerate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType, contentText, theme }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast(data.error || "Failed to regenerate prompt", "error");
        return;
      }
      const data = await res.json();
      if (data.prompt) onPromptChange(data.prompt);
    } catch {
      toast("Failed to regenerate prompt", "error");
    } finally {
      setRegeneratingPromptKey(null);
    }
  }

  function renderAlwaysVisiblePrompt(key: string, prompt: string, onPromptChange: (value: string) => void, aspectRatio?: string, contentContext?: { type: string; text: string }) {
    const isRegeneratingPrompt = regeneratingPromptKey === key;
    return (
      <div className="mt-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-slate-500 dark:text-slate-400">Image prompt:</label>
          {contentContext && (
            <button
              onClick={() => handleRegeneratePrompt(key, contentContext.type, contentContext.text, onPromptChange)}
              disabled={isRegeneratingPrompt}
              className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 font-medium transition-colors disabled:opacity-50"
            >
              <svg className={`w-3.5 h-3.5 ${isRegeneratingPrompt ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isRegeneratingPrompt ? "Regenerating..." : "Regenerate prompt"}
            </button>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-sky-500"
        />
        <button
          onClick={() => onGenerateImage(key, withBrandContext(prompt), aspectRatio)}
          disabled={imageLoading.has(key) || !prompt.trim()}
          className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors"
        >
          <svg className={`w-4 h-4 ${imageLoading.has(key) ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {imageLoading.has(key) ? "Generating..." : "Generate image"}
        </button>
      </div>
    );
  }

  function buildCarouselSlidePrompt(carousel: GeneratedContent["carousels"][number], slideIndex: number): string {
    const s = carousel.slides[slideIndex];
    const allTitles = carousel.slides.map((sl, idx) => `${idx + 1}. ${sl.title}`).join("; ");
    return `Create a social media carousel slide image. Overall carousel topic with ${carousel.slides.length} slides: [${allTitles}]. This slide (${slideIndex + 1} of ${carousel.slides.length}): "${s.title} - ${s.body}". Visual style for ALL slides: ${carousel.imagePrompt}. IMPORTANT: Use a consistent layout, typography, illustration style, and color scheme that would look unified across all slides in this carousel. Do not include any logo or watermark.`;
  }

  function withBrandContext(prompt: string): string {
    let enhanced = prompt;
    if (brandColors && brandColors.length > 0) {
      enhanced += `. The brand colors are ${brandColors.join(", ")} — use these as a subtle reference for accents and design elements, but do not fill the entire image with these colors`;
    }
    if (character) {
      enhanced += `. ${character}`;
    }
    return enhanced;
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
      {/* Drive import modal */}
      {showDriveImport && onDriveImport && (
        <DriveImportModal
          companyName={companyName}
          companyId={companyId}
          content={content}
          images={images}
          onImport={(imported) => {
            onDriveImport(imported);
            setShowDriveImport(false);
          }}
          onClose={() => setShowDriveImport(false)}
        />
      )}

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
          <button
            onClick={handleSendToSlack}
            disabled={slackSending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors text-sm"
          >
            <svg className={`w-4 h-4 ${slackSending ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
            </svg>
            {slackSending ? "Sending..." : "Send to Slack"}
          </button>
          {driveStatus?.enabled && (
            <button
              onClick={() => setShowDriveImport(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-sky-500 dark:border-sky-400 text-sky-700 dark:text-sky-300 font-medium hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import from Drive
            </button>
          )}
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
                    {content.posts.length > 1 && <RemoveButton onClick={() => onRemoveItem("posts", i)} />}
                  </div>
                </div>
                {isEditing ? (
                  <>
                    <label className="block text-xs text-slate-500 mb-1">Title:</label>
                    <input type="text" value={p.title} onChange={(e) => updatePost(i, "title", e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 font-semibold focus:ring-2 focus:ring-sky-500" />
                    <label className="block text-xs text-slate-500 mb-1">Caption:</label>
                    <textarea value={p.caption} onChange={(e) => updatePost(i, "caption", e.target.value)} rows={6} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 focus:ring-2 focus:ring-sky-500" />
                    <div className="flex gap-3 mb-3"><CharCount text={p.caption} limit={2200} label="IG" /> <CharCount text={p.caption} limit={3000} label="LinkedIn" /></div>
                  </>
                ) : (
                  <>
                    <h4 className="font-semibold text-sky-600 dark:text-sky-400 mb-2">{p.title}</h4>
                    <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{p.caption}</p>
                    <div className="flex gap-3 mt-1"><CharCount text={p.caption} limit={2200} label="IG" /> <CharCount text={p.caption} limit={3000} label="LinkedIn" /></div>
                  </>
                )}
                {images[key] && renderImageWithRegenerate(key, p.imagePrompt, `post-${i + 1}.png`)}
                {renderAlwaysVisiblePrompt(key, p.imagePrompt, (v) => updatePost(i, "imagePrompt", v), undefined, { type: "social media post", text: `${p.title}\n${p.caption}` })}
                <PostingDatePicker itemId={key} date={postingDates[key]} onChange={onPostingDateChange} />
              </div>
            );
          })}
          {renderAddButton("post", "posts", "post")}
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
                    <CopyButton text={`${r.caption || ""}\n\n${r.script}`} label="Copy" />
                    <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                    {content.reels.length > 1 && <RemoveButton onClick={() => onRemoveItem("reels", i)} />}
                    <button
                      onClick={() => handleSendToEditor(i)}
                      disabled={sendingToEditor.has(key) || sentToEditor.has(key)}
                      className={`inline-flex items-center gap-1.5 text-sm font-medium transition-colors ${
                        sentToEditor.has(key)
                          ? "text-green-600 dark:text-green-400"
                          : "text-slate-600 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400"
                      } disabled:opacity-70`}
                    >
                      {sendingToEditor.has(key) ? (
                        <>
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                          Sending...
                        </>
                      ) : sentToEditor.has(key) ? (
                        <>
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                          Sent
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                          Send to Editor
                        </>
                      )}
                    </button>
                  </div>
                </div>
                {isEditing ? (
                  <>
                    <label className="block text-xs text-slate-500 mb-1">Script (spoken words):</label>
                    <textarea value={r.script} onChange={(e) => updateReel(i, "script", e.target.value)} rows={8} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 focus:ring-2 focus:ring-sky-500" />
                    <div className="mb-3"><WordCount text={r.script} label="Script" /></div>
                    <label className="block text-xs text-slate-500 mb-1">Caption (posted with the reel):</label>
                    <textarea value={r.caption || ""} onChange={(e) => updateReel(i, "caption", e.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 focus:ring-2 focus:ring-sky-500" />
                    <div className="flex gap-3 mb-3"><CharCount text={r.caption || ""} limit={2200} label="IG" /></div>
                  </>
                ) : (
                  <>
                    <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{r.script}</p>
                    <div className="mt-1"><WordCount text={r.script} label="Script" /></div>
                    {(r.caption || "") && (
                      <div className="mt-3 p-3 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800">
                        <p className="text-xs text-sky-600 dark:text-sky-400 font-medium mb-1">Caption:</p>
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{r.caption}</p>
                        <div className="mt-1"><CharCount text={r.caption || ""} limit={2200} label="IG" /></div>
                      </div>
                    )}
                  </>
                )}
                <PostingDatePicker itemId={key} date={postingDates[key]} onChange={onPostingDateChange} />
              </div>
            );
          })}
          {renderAddButton("reel", "reels", "reel")}
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
                    {content.linkedinArticles.length > 1 && <RemoveButton onClick={() => onRemoveItem("linkedinArticles", i)} />}
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
                  </>
                )}
                {images[key] && renderImageWithRegenerate(key, a.imagePrompt, `article-${i + 1}-hero.png`, "16:9")}
                {renderAlwaysVisiblePrompt(key, a.imagePrompt, (v) => updateArticle(i, "imagePrompt", v), "16:9", { type: "LinkedIn article hero image", text: `${a.title}\n${a.caption}` })}
                <PostingDatePicker itemId={key} date={postingDates[key]} onChange={onPostingDateChange} />
              </div>
            );
          })}
          {renderAddButton("linkedinArticle", "linkedinArticles", "article")}
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
            const carouselText = (c.caption ? `Caption:\n${c.caption}\n\n` : "") + c.slides.map((s, j) => `Slide ${j + 1}: ${s.title}\n${s.body}`).join("\n\n");
            const isFresh = freshlyRegenerated.has(key);
            return (
              <div key={i} className={`mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 transition-all ${freshClass(key)}`}>
                <div className="flex items-center justify-between mb-3">
                  {renderFreshBadge(key)}
                  <div className={`flex items-center gap-3 ${isFresh ? "" : "ml-auto"}`}>
                    <RegenerateButton loading={regeneratingKey === key} onClick={() => handleRegenerate(key, "carousel", c, (item) => { const newCarousels = [...content.carousels]; newCarousels[i] = item; onChange({ ...content, carousels: newCarousels }); }, "carousels")} />
                    <CopyButton text={carouselText} label="Copy slides" />
                    <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                    {content.carousels.length > 1 && <RemoveButton onClick={() => onRemoveItem("carousels", i)} />}
                  </div>
                </div>
                {/* Carousel caption */}
                {c.caption && !isEditing && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">Post Caption</span>
                      <CopyButton text={c.caption} label="Copy caption" />
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{c.caption}</p>
                  </div>
                )}
                {isEditing ? (
                  <>
                    <label className="block text-xs text-slate-500 mb-1">Post caption:</label>
                    <textarea value={c.caption || ""} onChange={(e) => updateCarousel(i, "caption", e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm mb-4 focus:ring-2 focus:ring-sky-500" placeholder="Social media caption for this carousel..." />
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
                    {/* Generate all slide images button */}
                    {(() => {
                      const pendingSlides = c.slides.filter((_, j) => !images[`carousel-${i}-slide-${j}`]);
                      const loadingSlides = c.slides.filter((_, j) => imageLoading.has(`carousel-${i}-slide-${j}`));
                      if (pendingSlides.length > 0) return (
                        <div className="mb-4">
                          <button
                            onClick={() => onGenerateCarouselImages(i)}
                            disabled={loadingSlides.length > 0}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 text-white font-medium hover:bg-sky-700 disabled:opacity-50 transition-colors text-sm"
                          >
                            <svg className={`w-4 h-4 ${loadingSlides.length > 0 ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            {loadingSlides.length > 0
                              ? `Generating slide images (slide 1 sets the style)...`
                              : `Generate all ${pendingSlides.length} slide images`}
                          </button>
                          {loadingSlides.length > 0 && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Slide 1 generates first to set the style, then remaining slides match it.</p>
                          )}
                        </div>
                      );
                      return null;
                    })()}
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
                                  Generating slide {j + 1}...
                                </div>
                              ) : (
                                <button onClick={() => onGenerateImage(slideKey, withBrandContext(buildCarouselSlidePrompt(c, j)), "1:1")} className="text-sm text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 font-medium">
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
                <PostingDatePicker itemId={key} date={postingDates[key]} onChange={onPostingDateChange} />
              </div>
            );
          })}
          {renderAddButton("carousel", "carousels", "carousel")}
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
                    {content.quotesForX.length > 1 && <RemoveButton onClick={() => onRemoveItem("quotesForX", i)} />}
                  </div>
                </div>
                {isEditing ? (
                  <>
                    <textarea value={q.quote} onChange={(e) => updateQuote(i, "quote", e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 focus:ring-2 focus:ring-sky-500" />
                    <div className="mb-3"><CharCount text={q.quote} limit={280} label="X" /></div>
                  </>
                ) : (
                  <>
                    <blockquote className="text-slate-800 dark:text-slate-200 text-lg italic">&ldquo;{q.quote}&rdquo;</blockquote>
                    <div className="mt-1"><CharCount text={q.quote} limit={280} label="X" /></div>
                  </>
                )}
                {images[key] && renderImageWithRegenerate(key, q.imagePrompt, `quote-${i + 1}.png`, "1:1")}
                {renderAlwaysVisiblePrompt(key, q.imagePrompt, (v) => updateQuote(i, "imagePrompt", v), "1:1", { type: "quote card", text: q.quote })}
                <PostingDatePicker itemId={key} date={postingDates[key]} onChange={onPostingDateChange} />
              </div>
            );
          })}
          {renderAddButton("quoteForX", "quotesForX", "quote")}
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
                    {content.youtube.length > 1 && <RemoveButton onClick={() => onRemoveItem("youtube", i)} />}
                  </div>
                </div>
                {isEditing ? (
                  <>
                    <input type="text" value={y.title} onChange={(e) => updateYoutube(i, "title", e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 font-semibold focus:ring-2 focus:ring-sky-500" />
                    <textarea value={y.script} onChange={(e) => updateYoutube(i, "script", e.target.value)} rows={12} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-1 text-sm focus:ring-2 focus:ring-sky-500" />
                    <div className="mb-3"><WordCount text={y.script} label="Script" /></div>
                  </>
                ) : (
                  <>
                    <h4 className="font-semibold text-slate-900 dark:text-white text-lg">{y.title}</h4>
                    <p className="text-slate-700 dark:text-slate-300 mt-3 whitespace-pre-wrap text-sm">{y.script}</p>
                    <div className="mt-1"><WordCount text={y.script} label="Script" /></div>
                  </>
                )}
                {images[key] && renderImageWithRegenerate(key, y.thumbnailPrompt || "", `youtube-${i + 1}-thumbnail.png`, "16:9")}
                {renderAlwaysVisiblePrompt(key, y.thumbnailPrompt || "", (v) => updateYoutube(i, "thumbnailPrompt", v), "16:9", { type: "YouTube thumbnail", text: `${y.title}\n${y.script.slice(0, 500)}` })}
                <PostingDatePicker itemId={`youtube-${i}`} date={postingDates[`youtube-${i}`]} onChange={onPostingDateChange} />
              </div>
            );
          })}
          {renderAddButton("youtube", "youtube", "video")}
        </div>
      )}
    </section>
  );
}
