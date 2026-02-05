"use client";

import { useState, useEffect } from "react";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";

type Company = { id: string; name: string };
type MemoryFile = { id: string; name: string; content: string; addedAt: string };
type Theme = { id: string; title: string; description: string };
type ContentCounts = {
  posts: number;
  reels: number;
  linkedinArticles: number;
  carousels: number;
  quotesForX: number;
  youtube: number;
};
type GeneratedContent = {
  posts: { caption: string; imagePrompt: string }[];
  reels: { script: string; imagePrompt?: string }[];
  linkedinArticles: { title: string; body: string; imagePrompt: string }[];
  carousels: { slides: { title: string; body: string }[]; imagePrompt: string }[];
  quotesForX: { quote: string; imagePrompt: string }[];
  youtube: { title: string; script: string; thumbnailPrompt?: string }[];
};
type SavedContentItem = {
  id: string;
  name: string;
  theme: Theme;
  content: GeneratedContent;
  savedAt: string;
};

const defaultCounts: ContentCounts = {
  posts: 2,
  reels: 1,
  linkedinArticles: 0,
  carousels: 1,
  quotesForX: 2,
  youtube: 0,
};

// Copy and Edit button components
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors"
    >
      {copied ? (
        <>
          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

function EditButton({ isEditing, onToggle }: { isEditing: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors"
    >
      {isEditing ? (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Done
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit
        </>
      )}
    </button>
  );
}

export default function Home() {
  // Company selection state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [addingCompany, setAddingCompany] = useState(false);

  // Memory state
  const [memoryFiles, setMemoryFiles] = useState<MemoryFile[]>([]);
  const [memoryName, setMemoryName] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [memorySaving, setMemorySaving] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Content generation state
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themesLoading, setThemesLoading] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null);
  const [counts, setCounts] = useState<ContentCounts>(defaultCounts);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [images, setImages] = useState<Record<string, string>>({});
  const [imageLoading, setImageLoading] = useState<string | null>(null);

  // Editing state
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // Saved content state
  const [savedContent, setSavedContent] = useState<SavedContentItem[]>([]);
  const [savedContentLoading, setSavedContentLoading] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [saveContentName, setSaveContentName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(null);
  const [deletingSavedId, setDeletingSavedId] = useState<string | null>(null);

  // Load companies on mount
  useEffect(() => {
    loadCompanies();
  }, []);

  // Load memory and saved content when company is selected
  useEffect(() => {
    if (selectedCompany) {
      loadMemoryFiles();
      loadSavedContent();
      // Reset content-related state when switching companies
      setThemes([]);
      setSelectedTheme(null);
      setContent(null);
      setImages({});
      setCurrentSavedId(null);
    }
  }, [selectedCompany]);

  async function loadCompanies() {
    setCompaniesLoading(true);
    try {
      const res = await fetch("/api/companies");
      const data = await res.json();
      if (res.ok && data.companies) {
        setCompanies(data.companies);
      }
    } catch {
      // ignore
    } finally {
      setCompaniesLoading(false);
    }
  }

  async function handleAddCompany() {
    if (!newCompanyName.trim()) return;
    setAddingCompany(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCompanyName.trim() }),
      });
      if (res.ok) {
        const company = await res.json();
        setCompanies((prev) => [...prev, company]);
        setNewCompanyName("");
      } else {
        const data = await res.json();
        alert(data.error || "Failed to add company");
      }
    } finally {
      setAddingCompany(false);
    }
  }

  async function loadMemoryFiles() {
    if (!selectedCompany) return;
    try {
      const res = await fetch(`/api/memory?companyId=${selectedCompany.id}`);
      const data = await res.json();
      if (res.ok && data.files) {
        setMemoryFiles(data.files);
      }
    } catch {
      // ignore
    }
  }

  async function loadSavedContent() {
    if (!selectedCompany) return;
    setSavedContentLoading(true);
    try {
      const res = await fetch(`/api/saved-content?companyId=${selectedCompany.id}`);
      const data = await res.json();
      if (res.ok && data.items) {
        setSavedContent(data.items);
      }
    } catch {
      // ignore
    } finally {
      setSavedContentLoading(false);
    }
  }

  async function handleSaveContent() {
    if (!selectedCompany || !content || !selectedTheme || !saveContentName.trim()) return;
    setSavingContent(true);
    try {
      const res = await fetch("/api/saved-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          name: saveContentName.trim(),
          theme: selectedTheme,
          content,
        }),
      });
      if (res.ok) {
        const item = await res.json();
        setSavedContent((prev) => [item, ...prev]);
        setCurrentSavedId(item.id);
        setShowSaveDialog(false);
        setSaveContentName("");
      } else {
        const data = await res.json();
        alert(data.error || "Failed to save content");
      }
    } finally {
      setSavingContent(false);
    }
  }

  async function handleUpdateSavedContent() {
    if (!selectedCompany || !content || !currentSavedId) return;
    setSavingContent(true);
    try {
      const res = await fetch("/api/saved-content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          id: currentSavedId,
          content,
        }),
      });
      if (res.ok) {
        setSavedContent((prev) =>
          prev.map((item) =>
            item.id === currentSavedId ? { ...item, content } : item
          )
        );
      } else {
        const data = await res.json();
        alert(data.error || "Failed to update content");
      }
    } finally {
      setSavingContent(false);
    }
  }

  async function handleDeleteSavedContent(id: string) {
    if (!selectedCompany) return;
    setDeletingSavedId(id);
    try {
      const res = await fetch(`/api/saved-content?companyId=${selectedCompany.id}&id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSavedContent((prev) => prev.filter((item) => item.id !== id));
        if (currentSavedId === id) {
          setCurrentSavedId(null);
        }
      }
    } finally {
      setDeletingSavedId(null);
    }
  }

  function handleLoadSavedContent(item: SavedContentItem) {
    setSelectedTheme(item.theme);
    setContent(item.content);
    setCurrentSavedId(item.id);
    setImages({});
    setEditingKey(null);
  }

  async function handleDeleteMemory(id: string) {
    if (!selectedCompany) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/memory?id=${id}&companyId=${selectedCompany.id}`, { method: "DELETE" });
      if (res.ok) {
        setMemoryFiles((prev) => prev.filter((f) => f.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveMemory() {
    if (!selectedCompany || !memoryName.trim() || !memoryContent.trim()) return;
    setMemorySaving(true);
    setMemorySaved(false);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          name: memoryName.trim(),
          content: memoryContent.trim(),
        }),
      });
      if (res.ok) {
        setMemorySaved(true);
        setMemoryContent("");
        setMemoryName("");
        loadMemoryFiles();
      }
    } finally {
      setMemorySaving(false);
    }
  }

  async function handleGetThemes() {
    if (!selectedCompany) return;
    setThemesLoading(true);
    setThemes([]);
    setSelectedTheme(null);
    setContent(null);
    try {
      const res = await fetch("/api/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompany.id }),
      });
      const data = await res.json();
      if (res.ok && data.themes?.length) setThemes(data.themes);
      else if (!res.ok) alert(data.error || "Failed to load themes");
    } finally {
      setThemesLoading(false);
    }
  }

  async function handleGenerateContent() {
    if (!selectedCompany || !selectedTheme) return;
    setContentLoading(true);
    setContent(null);
    setEditingKey(null);
    setCurrentSavedId(null);
    try {
      const res = await fetch("/api/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          theme: selectedTheme,
          counts,
        }),
      });
      const data = await res.json();
      if (res.ok) setContent(data);
      else alert(data.error || "Failed to generate content");
    } finally {
      setContentLoading(false);
    }
  }

  async function generateImage(key: string, prompt: string, aspectRatio?: string) {
    setImageLoading(key);
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
      setImageLoading(null);
    }
  }

  // Content update helpers
  function updatePost(index: number, field: "caption" | "imagePrompt", value: string) {
    if (!content) return;
    const newPosts = [...content.posts];
    newPosts[index] = { ...newPosts[index], [field]: value };
    setContent({ ...content, posts: newPosts });
  }

  function updateReel(index: number, field: "script" | "imagePrompt", value: string) {
    if (!content) return;
    const newReels = [...content.reels];
    newReels[index] = { ...newReels[index], [field]: value };
    setContent({ ...content, reels: newReels });
  }

  function updateArticle(index: number, field: "title" | "body" | "imagePrompt", value: string) {
    if (!content) return;
    const newArticles = [...content.linkedinArticles];
    newArticles[index] = { ...newArticles[index], [field]: value };
    setContent({ ...content, linkedinArticles: newArticles });
  }

  function updateCarousel(index: number, field: "imagePrompt", value: string) {
    if (!content) return;
    const newCarousels = [...content.carousels];
    newCarousels[index] = { ...newCarousels[index], [field]: value };
    setContent({ ...content, carousels: newCarousels });
  }

  function updateCarouselSlide(carouselIndex: number, slideIndex: number, field: "title" | "body", value: string) {
    if (!content) return;
    const newCarousels = [...content.carousels];
    const newSlides = [...newCarousels[carouselIndex].slides];
    newSlides[slideIndex] = { ...newSlides[slideIndex], [field]: value };
    newCarousels[carouselIndex] = { ...newCarousels[carouselIndex], slides: newSlides };
    setContent({ ...content, carousels: newCarousels });
  }

  function updateQuote(index: number, field: "quote" | "imagePrompt", value: string) {
    if (!content) return;
    const newQuotes = [...content.quotesForX];
    newQuotes[index] = { ...newQuotes[index], [field]: value };
    setContent({ ...content, quotesForX: newQuotes });
  }

  function updateYoutube(index: number, field: "title" | "script" | "thumbnailPrompt", value: string) {
    if (!content) return;
    const newYoutube = [...content.youtube];
    newYoutube[index] = { ...newYoutube[index], [field]: value };
    setContent({ ...content, youtube: newYoutube });
  }

  async function downloadReelsAsWord() {
    if (!content?.reels.length) return;

    const children: Paragraph[] = [
      new Paragraph({
        text: "Reel Scripts",
        heading: HeadingLevel.HEADING_1,
      }),
      new Paragraph({ text: "" }),
    ];

    content.reels.forEach((reel, index) => {
      children.push(
        new Paragraph({
          text: `Reel ${index + 1}`,
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({ text: "" }),
        new Paragraph({
          children: [new TextRun({ text: reel.script })],
        }),
        new Paragraph({ text: "" }),
        new Paragraph({ text: "---" }),
        new Paragraph({ text: "" }),
      );
    });

    const doc = new Document({
      sections: [{ properties: {}, children }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, "reel-scripts.docx");
  }

  async function downloadArticlesAsWord() {
    if (!content?.linkedinArticles.length) return;

    const children: Paragraph[] = [
      new Paragraph({
        text: "LinkedIn Articles",
        heading: HeadingLevel.HEADING_1,
      }),
      new Paragraph({ text: "" }),
    ];

    content.linkedinArticles.forEach((article, index) => {
      children.push(
        new Paragraph({
          text: `Article ${index + 1}: ${article.title}`,
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({ text: "" }),
      );

      // Split body into paragraphs
      article.body.split("\n").forEach((para) => {
        children.push(new Paragraph({ children: [new TextRun({ text: para })] }));
      });

      children.push(
        new Paragraph({ text: "" }),
        new Paragraph({ text: "---" }),
        new Paragraph({ text: "" }),
      );
    });

    const doc = new Document({
      sections: [{ properties: {}, children }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, "linkedin-articles.docx");
  }

  async function handleFileUpload(files: FileList) {
    if (!selectedCompany) return;
    setUploadError(null);
    setUploadProgress(null);
    setMemorySaved(false);

    const MAX_SIZES = {
      text: 5 * 1024 * 1024,   // 5 MB
      pdf: 10 * 1024 * 1024,   // 10 MB
      image: 5 * 1024 * 1024,  // 5 MB
      word: 10 * 1024 * 1024,  // 10 MB
    };

    const fileArray = Array.from(files);
    let successCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      const isText = ["txt", "md"].includes(extension);
      const isPdf = extension === "pdf";
      const isImage = ["jpg", "jpeg", "png"].includes(extension);
      const isWord = ["doc", "docx"].includes(extension);

      // Determine file type and validate size
      let fileType: "text" | "pdf" | "image" | "word";
      let maxSize: number;

      if (isText) {
        fileType = "text";
        maxSize = MAX_SIZES.text;
      } else if (isPdf) {
        fileType = "pdf";
        maxSize = MAX_SIZES.pdf;
      } else if (isImage) {
        fileType = "image";
        maxSize = MAX_SIZES.image;
      } else if (isWord) {
        fileType = "word";
        maxSize = MAX_SIZES.word;
      } else {
        errors.push(`${file.name}: Unsupported file type`);
        continue;
      }

      if (file.size > maxSize) {
        errors.push(`${file.name}: Too large (max ${maxSize / (1024 * 1024)} MB)`);
        continue;
      }

      const fileName = file.name.replace(/\.[^.]+$/, "");

      if (fileType === "text") {
        // For text files with single file, load into textarea
        if (fileArray.length === 1) {
          setMemoryName(fileName);
          const text = await file.text();
          setMemoryContent(text);
          successCount++;
        } else {
          // For multiple files, save text directly
          setUploadProgress(`Processing ${i + 1}/${fileArray.length}: ${file.name}...`);
          try {
            const text = await file.text();
            const res = await fetch("/api/memory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                companyId: selectedCompany.id,
                name: fileName,
                content: text,
              }),
            });
            if (res.ok) successCount++;
            else {
              const data = await res.json();
              errors.push(`${file.name}: ${data.error || "Failed"}`);
            }
          } catch {
            errors.push(`${file.name}: Upload failed`);
          }
        }
      } else {
        // For PDF, Word, and images, send to server for processing
        const typeLabel = fileType === "pdf" ? "PDF" : fileType === "word" ? "Word doc" : "image";
        setUploadProgress(`Processing ${fileArray.length > 1 ? `${i + 1}/${fileArray.length}: ` : ""}${typeLabel}...`);

        try {
          const buffer = await file.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(buffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ""
            )
          );

          const res = await fetch("/api/memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId: selectedCompany.id,
              name: fileName,
              fileData: base64,
              fileType: fileType,
              mimeType: file.type,
            }),
          });

          const data = await res.json();

          if (res.ok) {
            successCount++;
          } else {
            errors.push(`${file.name}: ${data.error || "Failed to process"}`);
          }
        } catch {
          errors.push(`${file.name}: Upload failed`);
        }
      }
    }

    setUploadProgress(null);

    if (successCount > 0) {
      loadMemoryFiles();
      if (fileArray.length > 1) {
        setMemorySaved(true);
        setMemoryContent("");
        setMemoryName("");
      } else if (fileArray.length === 1 && !["txt", "md"].includes(fileArray[0].name.split(".").pop()?.toLowerCase() || "")) {
        setMemorySaved(true);
        setMemoryContent("");
        setMemoryName("");
      }
    }

    if (errors.length > 0) {
      setUploadError(errors.join("\n"));
    }
  }

  function handleBackToCompanies() {
    setSelectedCompany(null);
    setMemoryFiles([]);
    setThemes([]);
    setSelectedTheme(null);
    setContent(null);
    setImages({});
  }

  // Company selection screen
  if (!selectedCompany) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
        <div className="max-w-3xl mx-auto px-6 py-16">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent mb-3">
              Post Creator
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-lg">
              Select a company to get started
            </p>
          </div>

          {companiesLoading ? (
            <div className="flex justify-center py-12">
              <svg className="animate-spin h-8 w-8 text-indigo-600" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 mb-8">
                {companies.map((company) => (
                  <button
                    key={company.id}
                    onClick={() => setSelectedCompany(company)}
                    className="group relative overflow-hidden rounded-2xl bg-white dark:bg-slate-800 p-8 shadow-lg hover:shadow-xl transition-all duration-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="relative">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg">
                        <span className="text-white font-bold text-xl">
                          {company.name.charAt(0)}
                        </span>
                      </div>
                      <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-1">
                        {company.name}
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Click to manage content
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Add new company */}
              <div className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
                  Add New Company
                </h3>
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="Company name"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddCompany()}
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  />
                  <button
                    onClick={handleAddCompany}
                    disabled={addingCompany || !newCompanyName.trim()}
                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
                  >
                    {addingCompany ? "Adding..." : "Add"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    );
  }

  // Main Post Creator UI
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      {/* Header */}
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
          <h1 className="text-3xl font-bold">
            {selectedCompany.name}
          </h1>
          <p className="text-indigo-100 mt-1">
            Content themes from your memory - scripts, captions, articles & images
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8 pb-20">
        {/* Memory */}
        <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-sm font-bold">1</span>
            Add to memory
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 ml-11">
            Paste or type context, or upload files (.txt, .md, .pdf, .doc, .docx, .jpg, .png). Documents and images will be processed to extract text.
          </p>

          <div className="ml-11">
            <label className="mb-3 block">
              <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">Upload file(s):</span>
              <input
                type="file"
                multiple
                accept=".txt,.md,.pdf,.doc,.docx,.jpg,.jpeg,.png,text/plain,text/markdown,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
                className="mt-2 block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-100 file:px-4 file:py-2 file:text-indigo-700 file:font-medium dark:file:bg-indigo-900/30 dark:file:text-indigo-300 file:cursor-pointer hover:file:bg-indigo-200 dark:hover:file:bg-indigo-900/50 transition-colors"
                onChange={async (e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  await handleFileUpload(files);
                  e.target.value = "";
                }}
              />
            </label>
            {uploadProgress && (
              <p className="text-sm text-indigo-600 dark:text-indigo-400 mt-2 flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {uploadProgress}
              </p>
            )}
            {uploadError && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-2 whitespace-pre-wrap">
                {uploadError}
              </p>
            )}
            <input
              type="text"
              placeholder="Name (e.g. Brand guidelines)"
              value={memoryName}
              onChange={(e) => setMemoryName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 mb-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
            />
            <textarea
              placeholder="Paste your context here..."
              value={memoryContent}
              onChange={(e) => setMemoryContent(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 resize-y focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
            />
            <button
              onClick={handleSaveMemory}
              disabled={memorySaving || !memoryName.trim() || !memoryContent.trim()}
              className="mt-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 font-medium hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
            >
              {memorySaving ? "Saving..." : "Save to memory"}
            </button>
            {memorySaved && (
              <span className="ml-3 text-sm text-green-600 dark:text-green-400 font-medium">Saved!</span>
            )}

            {/* Memory Files List */}
            {memoryFiles.length > 0 && (
              <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-700">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                  Files in memory ({memoryFiles.length})
                </h3>
                <div className="space-y-2">
                  {memoryFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                          {file.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Added {new Date(file.addedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteMemory(file.id)}
                        disabled={deletingId === file.id}
                        className="ml-3 text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 font-medium"
                      >
                        {deletingId === file.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Saved Content */}
        {savedContent.length > 0 && (
          <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-3">
              <svg className="w-6 h-6 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Saved Content ({savedContent.length})
            </h2>
            <div className="space-y-3">
              {savedContent.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                    currentSavedId === item.id
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
                      : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
                      {item.name}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {item.theme.title} • Saved {new Date(item.savedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => handleLoadSavedContent(item)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-sm font-medium hover:bg-indigo-200 dark:hover:bg-indigo-900 transition-colors"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => handleDeleteSavedContent(item.id)}
                      disabled={deletingSavedId === item.id}
                      className="px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900 disabled:opacity-50 transition-colors"
                    >
                      {deletingSavedId === item.id ? "..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Themes */}
        <section className="mb-8 rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-sm font-bold">2</span>
            Get content themes
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 ml-11">
            Generate theme ideas based on your memory. Each theme can inspire unlimited content.
          </p>
          <div className="ml-11">
            <button
              onClick={handleGetThemes}
              disabled={themesLoading}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 font-medium hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
            >
              {themesLoading ? "Generating themes..." : "Get theme ideas"}
            </button>
            {themes.length > 0 && (
              <div className="mt-5 grid gap-3">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedTheme(t);
                      setContent(null);
                    }}
                    className={`text-left rounded-xl border-2 p-4 transition-all ${
                      selectedTheme?.id === t.id
                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 shadow-md"
                        : "border-slate-200 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-sm"
                    }`}
                  >
                    <span className="font-semibold text-slate-900 dark:text-white">{t.title}</span>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t.description}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Counts + Generate */}
        {selectedTheme && (
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
                      onChange={(e) => setCounts((c) => ({ ...c, [key]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                      className="rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                    />
                  </label>
                ))}
              </div>
              <button
                onClick={handleGenerateContent}
                disabled={contentLoading}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 font-medium hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
              >
                {contentLoading ? "Generating content..." : "Generate scripts & captions"}
              </button>
            </div>
          </section>
        )}

        {/* Results */}
        {content && (
          <section className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400 text-sm font-bold">4</span>
                Your content
                {currentSavedId && (
                  <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                    (saved)
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2">
                {currentSavedId ? (
                  <button
                    onClick={handleUpdateSavedContent}
                    disabled={savingContent}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {savingContent ? "Saving..." : "Update Saved"}
                  </button>
                ) : (
                  <button
                    onClick={() => setShowSaveDialog(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    Save Content
                  </button>
                )}
              </div>
            </div>

            {/* Save Dialog */}
            {showSaveDialog && (
              <div className="mb-6 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
                <h3 className="font-medium text-slate-800 dark:text-slate-200 mb-3">Save this content</h3>
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="Name (e.g. Week 1 Content)"
                    value={saveContentName}
                    onChange={(e) => setSaveContentName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveContent()}
                    className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={handleSaveContent}
                    disabled={savingContent || !saveContentName.trim()}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {savingContent ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => {
                      setShowSaveDialog(false);
                      setSaveContentName("");
                    }}
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
                <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-3 text-lg">Posts</h3>
                {content.posts.map((p, i) => {
                  const key = `post-${i}`;
                  const isEditing = editingKey === key;
                  return (
                    <div key={i} className="mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
                      <div className="flex items-center justify-end gap-3 mb-3">
                        <CopyButton text={p.caption} label="Copy caption" />
                        <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                      </div>
                      {isEditing ? (
                        <>
                          <textarea
                            value={p.caption}
                            onChange={(e) => updatePost(i, "caption", e.target.value)}
                            rows={6}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 focus:ring-2 focus:ring-indigo-500"
                          />
                          <label className="block text-xs text-slate-500 mb-1">Image prompt:</label>
                          <textarea
                            value={p.imagePrompt}
                            onChange={(e) => updatePost(i, "imagePrompt", e.target.value)}
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                          />
                        </>
                      ) : (
                        <>
                          <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{p.caption}</p>
                          <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Image prompt: {p.imagePrompt}</p>
                        </>
                      )}
                      {images[key] ? (
                        <img src={images[key]} alt="" className="mt-3 rounded-xl max-h-64 object-cover shadow-md" />
                      ) : (
                        <button
                          onClick={() => generateImage(key, p.imagePrompt)}
                          disabled={imageLoading === key}
                          className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:text-indigo-800 dark:hover:text-indigo-300"
                        >
                          {imageLoading === key ? "Generating..." : "Generate image (Gemini)"}
                        </button>
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
                  <h3 className="font-semibold text-slate-700 dark:text-slate-300 text-lg">Reels</h3>
                  <button
                    onClick={downloadReelsAsWord}
                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium"
                  >
                    Download as Word
                  </button>
                </div>
                {content.reels.map((r, i) => {
                  const key = `reel-${i}`;
                  const isEditing = editingKey === key;
                  return (
                    <div key={i} className="mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
                      <div className="flex items-center justify-end gap-3 mb-3">
                        <CopyButton text={r.script} label="Copy script" />
                        <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                      </div>
                      {isEditing ? (
                        <>
                          <textarea
                            value={r.script}
                            onChange={(e) => updateReel(i, "script", e.target.value)}
                            rows={8}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 focus:ring-2 focus:ring-indigo-500"
                          />
                          {r.imagePrompt !== undefined && (
                            <>
                              <label className="block text-xs text-slate-500 mb-1">Thumbnail prompt:</label>
                              <textarea
                                value={r.imagePrompt || ""}
                                onChange={(e) => updateReel(i, "imagePrompt", e.target.value)}
                                rows={2}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                              />
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{r.script}</p>
                          {r.imagePrompt && (
                            <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Thumbnail: {r.imagePrompt}</p>
                          )}
                        </>
                      )}
                      {r.imagePrompt && (
                        <>
                          {!images[key] && (
                            <button
                              onClick={() => generateImage(key, r.imagePrompt!, "9:16")}
                              disabled={imageLoading === key}
                              className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:text-indigo-800 dark:hover:text-indigo-300"
                            >
                              {imageLoading === key ? "Generating..." : "Generate thumbnail"}
                            </button>
                          )}
                          {images[key] && (
                            <img src={images[key]} alt="" className="mt-3 rounded-xl max-h-64 object-cover shadow-md" />
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
                  <h3 className="font-semibold text-slate-700 dark:text-slate-300 text-lg">LinkedIn articles</h3>
                  <button
                    onClick={downloadArticlesAsWord}
                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium"
                  >
                    Download as Word
                  </button>
                </div>
                {content.linkedinArticles.map((a, i) => {
                  const key = `article-${i}`;
                  const isEditing = editingKey === key;
                  return (
                    <div key={i} className="mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
                      <div className="flex items-center justify-end gap-3 mb-3">
                        <CopyButton text={`${a.title}\n\n${a.body}`} label="Copy article" />
                        <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                      </div>
                      {isEditing ? (
                        <>
                          <input
                            type="text"
                            value={a.title}
                            onChange={(e) => updateArticle(i, "title", e.target.value)}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 font-semibold focus:ring-2 focus:ring-indigo-500"
                          />
                          <textarea
                            value={a.body}
                            onChange={(e) => updateArticle(i, "body", e.target.value)}
                            rows={12}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 text-sm focus:ring-2 focus:ring-indigo-500"
                          />
                          <label className="block text-xs text-slate-500 mb-1">Hero image prompt:</label>
                          <textarea
                            value={a.imagePrompt}
                            onChange={(e) => updateArticle(i, "imagePrompt", e.target.value)}
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                          />
                        </>
                      ) : (
                        <>
                          <h4 className="font-semibold text-slate-900 dark:text-white text-lg">{a.title}</h4>
                          <p className="text-slate-700 dark:text-slate-300 mt-3 whitespace-pre-wrap text-sm">{a.body}</p>
                          <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Hero image: {a.imagePrompt}</p>
                        </>
                      )}
                      {images[key] ? (
                        <img src={images[key]} alt="" className="mt-3 rounded-xl max-h-48 object-cover shadow-md" />
                      ) : (
                        <button
                          onClick={() => generateImage(key, a.imagePrompt, "16:9")}
                          disabled={imageLoading === key}
                          className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:text-indigo-800 dark:hover:text-indigo-300"
                        >
                          {imageLoading === key ? "Generating..." : "Generate hero image"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Carousels */}
            {content.carousels.length > 0 && (
              <div className="mb-8">
                <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-3 text-lg">Carousels</h3>
                {content.carousels.map((c, i) => {
                  const key = `carousel-${i}`;
                  const isEditing = editingKey === key;
                  const carouselText = c.slides.map((s, j) => `Slide ${j + 1}: ${s.title}\n${s.body}`).join("\n\n");
                  return (
                    <div key={i} className="mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
                      <div className="flex items-center justify-end gap-3 mb-3">
                        <CopyButton text={carouselText} label="Copy slides" />
                        <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                      </div>
                      {isEditing ? (
                        <>
                          {c.slides.map((s, j) => (
                            <div key={j} className="mb-4 pb-4 border-b border-slate-200 dark:border-slate-700 last:border-0">
                              <label className="block text-xs text-slate-500 mb-1">Slide {j + 1} title:</label>
                              <input
                                type="text"
                                value={s.title}
                                onChange={(e) => updateCarouselSlide(i, j, "title", e.target.value)}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-2 font-semibold focus:ring-2 focus:ring-indigo-500"
                              />
                              <label className="block text-xs text-slate-500 mb-1">Slide {j + 1} body:</label>
                              <textarea
                                value={s.body}
                                onChange={(e) => updateCarouselSlide(i, j, "body", e.target.value)}
                                rows={3}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                          ))}
                          <label className="block text-xs text-slate-500 mb-1">Image style prompt:</label>
                          <textarea
                            value={c.imagePrompt}
                            onChange={(e) => updateCarousel(i, "imagePrompt", e.target.value)}
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                          />
                        </>
                      ) : (
                        <>
                          {c.slides.map((s, j) => (
                            <div key={j} className="mb-3 pb-3 border-b border-slate-200 dark:border-slate-700 last:border-0 last:pb-0 last:mb-0">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">{s.title}</span>
                              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{s.body}</p>
                            </div>
                          ))}
                          <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Style: {c.imagePrompt}</p>
                        </>
                      )}
                      {images[key] ? (
                        <img src={images[key]} alt="" className="mt-3 rounded-xl max-h-48 object-cover shadow-md" />
                      ) : (
                        <button
                          onClick={() => generateImage(key, c.imagePrompt, "1:1")}
                          disabled={imageLoading === key}
                          className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:text-indigo-800 dark:hover:text-indigo-300"
                        >
                          {imageLoading === key ? "Generating..." : "Generate carousel image"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Quotes for X */}
            {content.quotesForX.length > 0 && (
              <div className="mb-8">
                <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-3 text-lg">Quotes for X</h3>
                {content.quotesForX.map((q, i) => {
                  const key = `quote-${i}`;
                  const isEditing = editingKey === key;
                  return (
                    <div key={i} className="mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
                      <div className="flex items-center justify-end gap-3 mb-3">
                        <CopyButton text={q.quote} label="Copy quote" />
                        <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                      </div>
                      {isEditing ? (
                        <>
                          <textarea
                            value={q.quote}
                            onChange={(e) => updateQuote(i, "quote", e.target.value)}
                            rows={3}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 focus:ring-2 focus:ring-indigo-500"
                          />
                          <label className="block text-xs text-slate-500 mb-1">Quote card prompt:</label>
                          <textarea
                            value={q.imagePrompt}
                            onChange={(e) => updateQuote(i, "imagePrompt", e.target.value)}
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                          />
                        </>
                      ) : (
                        <>
                          <blockquote className="text-slate-800 dark:text-slate-200 text-lg italic">"{q.quote}"</blockquote>
                          <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Card: {q.imagePrompt}</p>
                        </>
                      )}
                      {images[key] ? (
                        <img src={images[key]} alt="" className="mt-3 rounded-xl max-h-48 object-cover shadow-md" />
                      ) : (
                        <button
                          onClick={() => generateImage(key, q.imagePrompt, "1:1")}
                          disabled={imageLoading === key}
                          className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:text-indigo-800 dark:hover:text-indigo-300"
                        >
                          {imageLoading === key ? "Generating..." : "Generate quote card"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* YouTube */}
            {content.youtube.length > 0 && (
              <div className="mb-8">
                <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-3 text-lg">YouTube</h3>
                {content.youtube.map((y, i) => {
                  const key = `yt-${i}`;
                  const isEditing = editingKey === key;
                  return (
                    <div key={i} className="mb-4 p-5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
                      <div className="flex items-center justify-end gap-3 mb-3">
                        <CopyButton text={`${y.title}\n\n${y.script}`} label="Copy script" />
                        <EditButton isEditing={isEditing} onToggle={() => setEditingKey(isEditing ? null : key)} />
                      </div>
                      {isEditing ? (
                        <>
                          <input
                            type="text"
                            value={y.title}
                            onChange={(e) => updateYoutube(i, "title", e.target.value)}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 font-semibold focus:ring-2 focus:ring-indigo-500"
                          />
                          <textarea
                            value={y.script}
                            onChange={(e) => updateYoutube(i, "script", e.target.value)}
                            rows={12}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 mb-3 text-sm focus:ring-2 focus:ring-indigo-500"
                          />
                          {y.thumbnailPrompt !== undefined && (
                            <>
                              <label className="block text-xs text-slate-500 mb-1">Thumbnail prompt:</label>
                              <textarea
                                value={y.thumbnailPrompt || ""}
                                onChange={(e) => updateYoutube(i, "thumbnailPrompt", e.target.value)}
                                rows={2}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                              />
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <h4 className="font-semibold text-slate-900 dark:text-white text-lg">{y.title}</h4>
                          <p className="text-slate-700 dark:text-slate-300 mt-3 whitespace-pre-wrap text-sm">{y.script}</p>
                          {y.thumbnailPrompt && (
                            <p className="text-xs text-slate-500 mt-3 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">Thumbnail: {y.thumbnailPrompt}</p>
                          )}
                        </>
                      )}
                      {y.thumbnailPrompt && (
                        <>
                          {!images[key] && (
                            <button
                              onClick={() => generateImage(key, y.thumbnailPrompt!, "16:9")}
                              disabled={imageLoading === key}
                              className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:text-indigo-800 dark:hover:text-indigo-300"
                            >
                              {imageLoading === key ? "Generating..." : "Generate thumbnail"}
                            </button>
                          )}
                          {images[key] && (
                            <img src={images[key]} alt="" className="mt-3 rounded-xl max-h-32 object-cover shadow-md" />
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
