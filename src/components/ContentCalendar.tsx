"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { GeneratedContent } from "@/types";

interface CalendarItem {
  id: string;
  type: string;
  label: string;
  title: string;
  preview: string;
  fullText: string;
  color: string;
  // Extended fields for modal
  imageKey?: string;
  caption?: string;
  body?: string;
  script?: string;
  slides?: { title: string; body: string }[];
  carouselIndex?: number;
}

interface Props {
  content: GeneratedContent;
  startDate: Date;
  companyName: string;
  companyId: string;
  themeName: string;
  images?: Record<string, string>;
  postingDates?: Record<string, string>;
  onPostingDateChange?: (itemId: string, date: string | null) => void;
}

const TYPE_COLORS: Record<string, string> = {
  Post: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  Reel: "bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800",
  Article: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  Carousel: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  Quote: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  YouTube: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",
};

function collectItems(content: GeneratedContent): CalendarItem[] {
  const items: CalendarItem[] = [];
  content.posts.forEach((p, i) =>
    items.push({
      id: `post-${i}`,
      type: "Post",
      label: "Post",
      title: p.title,
      preview: p.caption.slice(0, 80),
      fullText: p.caption,
      color: TYPE_COLORS.Post,
      imageKey: `post-${i}`,
      caption: p.caption,
    })
  );
  content.reels.forEach((r, i) =>
    items.push({
      id: `reel-${i}`,
      type: "Reel",
      label: "Reel",
      title: `Reel ${i + 1}`,
      preview: (r.caption || r.script).slice(0, 80),
      fullText: r.caption ? `${r.caption}\n\n${r.script}` : r.script,
      color: TYPE_COLORS.Reel,
      caption: r.caption || undefined,
      script: r.script,
    })
  );
  content.linkedinArticles.forEach((a, i) =>
    items.push({
      id: `article-${i}`,
      type: "Article",
      label: "Article",
      title: a.title,
      preview: a.caption || a.body.slice(0, 80),
      fullText: a.caption ? `${a.caption}\n\n${a.body}` : a.body,
      color: TYPE_COLORS.Article,
      imageKey: `article-${i}`,
      caption: a.caption || undefined,
      body: a.body,
    })
  );
  content.carousels.forEach((c, i) =>
    items.push({
      id: `carousel-${i}`,
      type: "Carousel",
      label: "Carousel",
      title: c.slides[0]?.title || `Carousel ${i + 1}`,
      preview: c.caption || c.slides.map((s) => s.title).join(" / "),
      fullText: c.caption || c.slides.map((s) => `${s.title}: ${s.body}`).join("\n"),
      color: TYPE_COLORS.Carousel,
      caption: c.caption || undefined,
      slides: c.slides,
      carouselIndex: i,
    })
  );
  content.quotesForX.forEach((q, i) =>
    items.push({
      id: `quote-${i}`,
      type: "Quote",
      label: "Quote (X)",
      title: q.quote.slice(0, 40),
      preview: q.quote,
      fullText: q.quote,
      color: TYPE_COLORS.Quote,
      imageKey: `quote-${i}`,
    })
  );
  content.youtube.forEach((y, i) =>
    items.push({
      id: `youtube-${i}`,
      type: "YouTube",
      label: "YouTube",
      title: y.title,
      preview: y.script.slice(0, 80),
      fullText: y.script,
      color: TYPE_COLORS.YouTube,
      imageKey: `yt-${i}`,
      script: y.script,
    })
  );
  return items;
}

function getNextMonday(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay();
  const diff = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function distributeItemsDateAware(
  items: CalendarItem[],
  weekDays: Date[],
  postingDates: Record<string, string>
): CalendarItem[][] {
  const schedule: CalendarItem[][] = Array.from({ length: 7 }, () => []);
  if (items.length === 0) return schedule;

  // Build ISO date → day index map for the current week
  const dateToDay: Record<string, number> = {};
  weekDays.forEach((d, i) => {
    const iso = d.toISOString().slice(0, 10);
    dateToDay[iso] = i;
  });

  const undated: CalendarItem[] = [];

  // Place items with assigned dates
  items.forEach((item) => {
    const assignedDate = postingDates[item.id];
    if (assignedDate && dateToDay[assignedDate] !== undefined) {
      schedule[dateToDay[assignedDate]].push(item);
    } else if (!assignedDate) {
      undated.push(item);
    }
    // Items with a date outside the current week are excluded
  });

  // Auto-distribute undated items across weekdays (Mon-Fri) round-robin
  if (undated.length > 0) {
    let slot = 0;
    undated.forEach((item) => {
      schedule[slot % 5].push(item);
      slot++;
    });
  }

  return schedule;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------- ICS helpers ----------

function padTwo(n: number): string {
  return n.toString().padStart(2, "0");
}

function toICSDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = padTwo(date.getMonth() + 1);
  const d = padTwo(date.getDate());
  return `${y}${m}${d}`;
}

function foldLine(line: string): string {
  // ICS lines must be <= 75 octets; fold by inserting CRLF + space
  const maxLen = 75;
  if (line.length <= maxLen) return line;
  let result = line.slice(0, maxLen);
  let pos = maxLen;
  while (pos < line.length) {
    result += "\r\n " + line.slice(pos, pos + maxLen - 1);
    pos += maxLen - 1;
  }
  return result;
}

function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function generateUID(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}@postcreator`;
}

function generateICS(
  schedule: CalendarItem[][],
  weekDays: Date[]
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PostCreator//ContentCalendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  const now = new Date();
  const stamp = `${toICSDateStr(now)}T${padTwo(now.getHours())}${padTwo(now.getMinutes())}${padTwo(now.getSeconds())}`;

  schedule.forEach((dayItems, dayIndex) => {
    const dayDate = weekDays[dayIndex];
    if (!dayDate) return;
    const dateStr = toICSDateStr(dayDate);

    dayItems.forEach((item, itemIdx) => {
      // Schedule each item at 09:00 + 30min * itemIdx for that day
      const startHour = 9 + Math.floor((itemIdx * 30) / 60);
      const startMin = (itemIdx * 30) % 60;
      const endHour = startHour + Math.floor((startMin + 30) / 60);
      const endMin = (startMin + 30) % 60;

      const dtStart = `${dateStr}T${padTwo(startHour)}${padTwo(startMin)}00`;
      const dtEnd = `${dateStr}T${padTwo(endHour)}${padTwo(endMin)}00`;

      const summary = `${item.type}: ${item.title}`;
      const description = item.fullText;

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${generateUID()}`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART:${dtStart}`);
      lines.push(`DTEND:${dtEnd}`);
      lines.push(foldLine(`SUMMARY:${escapeICSText(summary)}`));
      lines.push(foldLine(`DESCRIPTION:${escapeICSText(description)}`));
      lines.push("END:VEVENT");
    });
  });

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadICS(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Detail Modal ----------

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function DownloadButton({ src, filename }: { src: string; filename: string }) {
  return (
    <button
      onClick={() => downloadDataUrl(src, filename)}
      className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
      title="Download image"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      Download
    </button>
  );
}

function DetailModal({ item, images, onClose }: { item: CalendarItem; images: Record<string, string>; onClose: () => void }) {
  const [captionCopied, setCaptionCopied] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Collect images for this item
  const itemImages: { key: string; src: string }[] = [];
  if (item.slides && item.carouselIndex !== undefined) {
    item.slides.forEach((_, j) => {
      const key = `carousel-${item.carouselIndex}-slide-${j}`;
      if (images[key]) itemImages.push({ key, src: images[key] });
    });
  } else if (item.imageKey && images[item.imageKey]) {
    itemImages.push({ key: item.imageKey, src: images[item.imageKey] });
  }

  // AI-generated carousel caption (for the post description)
  const carouselCaption = item.slides ? (item.caption || null) : null;

  const handleCopyCaption = () => {
    if (!carouselCaption) return;
    navigator.clipboard.writeText(carouselCaption).then(() => {
      setCaptionCopied(true);
      setTimeout(() => setCaptionCopied(false), 2000);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${item.color}`}>
              {item.label}
            </span>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">{item.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          {/* Caption (Posts, Articles) */}
          {item.caption && item.type !== "Reel" && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                {item.type === "Article" ? "LinkedIn Post Caption" : "Caption"}
              </h4>
              <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{item.caption}</p>
            </div>
          )}

          {/* Script (Reels, YouTube) */}
          {item.script && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Script</h4>
              <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap text-sm">{item.script}</p>
            </div>
          )}

          {/* Reel caption */}
          {item.caption && item.type === "Reel" && (
            <div className="p-3 rounded-lg bg-pink-50 dark:bg-pink-900/20 border border-pink-100 dark:border-pink-800">
              <h4 className="text-xs font-semibold text-pink-600 dark:text-pink-400 uppercase tracking-wide mb-1">Caption</h4>
              <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{item.caption}</p>
            </div>
          )}

          {/* Article body */}
          {item.body && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Article</h4>
              <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap text-sm">{item.body}</p>
            </div>
          )}

          {/* Quote full text */}
          {item.type === "Quote" && (
            <blockquote className="text-slate-800 dark:text-slate-200 text-lg italic border-l-4 border-purple-400 dark:border-purple-500 pl-4">
              &ldquo;{item.fullText}&rdquo;
            </blockquote>
          )}

          {/* Carousel: combined caption with copy button */}
          {carouselCaption && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Carousel Caption</h4>
                <button
                  onClick={handleCopyCaption}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                    captionCopied
                      ? "border-green-300 dark:border-green-600 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30"
                      : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {captionCopied ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy Caption
                    </>
                  )}
                </button>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap select-all">{carouselCaption}</p>
              </div>
            </div>
          )}

          {/* Carousel slides */}
          {item.slides && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Slides</h4>
              {item.slides.map((slide, j) => {
                const slideKey = `carousel-${item.carouselIndex}-slide-${j}`;
                const slideImg = images[slideKey];
                return (
                  <div key={j} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{j + 1}. {slide.title}</span>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{slide.body}</p>
                    {slideImg && (
                      <div>
                        <img src={slideImg} alt="" className="mt-2 rounded-lg max-h-48 object-cover" />
                        <DownloadButton src={slideImg} filename={`carousel-slide-${j + 1}.png`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Images (non-carousel) */}
          {itemImages.length > 0 && !item.slides && (
            <div>
              <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Image</h4>
              {itemImages.map((img) => (
                <div key={img.key}>
                  <img src={img.src} alt="" className="rounded-xl max-h-72 object-cover shadow-md" />
                  <DownloadButton src={img.src} filename={`${img.key}.png`} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Helpers ----------

function getItemThumbnail(item: CalendarItem, images: Record<string, string>): string | null {
  if (item.slides && item.carouselIndex !== undefined) {
    const firstSlide = `carousel-${item.carouselIndex}-slide-0`;
    return images[firstSlide] || null;
  }
  if (item.imageKey && images[item.imageKey]) {
    return images[item.imageKey];
  }
  return null;
}

// ---------- Component ----------

export default function ContentCalendar({ content, startDate, companyName, companyId, themeName, images = {}, postingDates = {}, onPostingDateChange }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [modalItem, setModalItem] = useState<CalendarItem | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [slackStatus, setSlackStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [slackSending, setSlackSending] = useState(false);

  const items = useMemo(() => collectItems(content), [content]);
  const monday = getNextMonday(startDate);
  monday.setDate(monday.getDate() + weekOffset * 7);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [monday.getTime()]);

  const schedule = useMemo(
    () => distributeItemsDateAware(items, weekDays, postingDates),
    [items, weekDays, postingDates]
  );

  const totalItems = items.length;

  // ---------- Drag-and-drop handlers ----------

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, fromDay: number, itemId: string) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({ fromDay, itemId }));
      if (e.currentTarget) {
        (e.currentTarget as HTMLElement).style.opacity = "0.5";
      }
    },
    []
  );

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).style.opacity = "1";
    setDragOverDay(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, dayIndex: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverDay(dayIndex);
    },
    []
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>, dayIndex: number) => {
      const related = e.relatedTarget as Node | null;
      if (related && (e.currentTarget as HTMLElement).contains(related)) return;
      if (dragOverDay === dayIndex) {
        setDragOverDay(null);
      }
    },
    [dragOverDay]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, toDay: number) => {
      e.preventDefault();
      setDragOverDay(null);

      let data: { fromDay: number; itemId: string };
      try {
        data = JSON.parse(e.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }

      const { fromDay, itemId } = data;
      if (fromDay === toDay) return;

      // Set the posting date for the dropped item to the target day's ISO date
      if (onPostingDateChange && weekDays[toDay]) {
        const isoDate = weekDays[toDay].toISOString().slice(0, 10);
        onPostingDateChange(itemId, isoDate);
      }
    },
    [onPostingDateChange, weekDays]
  );

  // ---------- ICS export ----------

  const handleExportICS = useCallback(() => {
    const icsStr = generateICS(schedule, weekDays);
    const startStr = toICSDateStr(weekDays[0]);
    downloadICS(icsStr, `content-calendar-${startStr}.ics`);
  }, [schedule, weekDays]);

  // ---------- Slack ----------

  const handleSendToSlack = useCallback(async () => {
    setSlackStatus(null);
    setSlackSending(true);

    const FULL_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const weekLabel = `${formatDate(weekDays[0])} – ${formatDate(weekDays[6])}`;

    const days = schedule.map((dayItems, dayIndex) => ({
      dayName: FULL_DAY_NAMES[dayIndex],
      date: formatDate(weekDays[dayIndex]),
      items: dayItems.map((item, itemIdx) => {
        const startHour = 9 + Math.floor((itemIdx * 30) / 60);
        const startMin = (itemIdx * 30) % 60;
        const period = startHour >= 12 ? "PM" : "AM";
        const displayHour = startHour > 12 ? startHour - 12 : startHour;
        const time = `${displayHour}:${startMin.toString().padStart(2, "0")} ${period}`;
        return {
          time,
          type: item.label,
          title: item.title,
          preview: item.preview,
          imageKey: item.imageKey || (item.type === "Carousel" ? item.id : undefined),
        };
      }),
    }));

    try {
      const res = await fetch("/api/notify-slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, companyId, themeName, weekLabel, days }),
      });
      const data = await res.json();
      if (res.ok) {
        setSlackStatus({ type: "success", message: "Schedule sent to Slack!" });
      } else {
        setSlackStatus({ type: "error", message: data.error || "Failed to send" });
      }
    } catch {
      setSlackStatus({ type: "error", message: "Network error" });
    } finally {
      setSlackSending(false);
      setTimeout(() => setSlackStatus(null), 5000);
    }
  }, [schedule, weekDays, companyName, companyId, themeName]);

  return (
    <div>
      {/* Detail modal */}
      {modalItem && (
        <DetailModal item={modalItem} images={images} onClose={() => setModalItem(null)} />
      )}

      {/* Week navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setWeekOffset((o) => o - 1)}
          className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-center">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200">
            {formatDate(weekDays[0])} &ndash; {formatDate(weekDays[6])}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{totalItems} items across the week</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSendToSlack}
            disabled={totalItems === 0 || slackSending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-purple-200 dark:border-purple-700 text-purple-600 dark:text-purple-300 bg-white dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Send schedule to Slack"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
            </svg>
            {slackSending ? "Sending..." : "Send to Slack"}
          </button>
          <button
            onClick={handleExportICS}
            disabled={totalItems === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Export to Calendar (.ics)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            Export to Calendar
          </button>
          <button
            onClick={() => setWeekOffset((o) => o + 1)}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Status feedback */}
      {slackStatus && (
        <div
          className={`mb-3 px-4 py-2 rounded-lg text-sm font-medium ${
            slackStatus.type === "success"
              ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
          }`}
        >
          {slackStatus.message}
        </div>
      )}
      {/* Calendar grid - weekdays only for more space */}
      <div className="grid grid-cols-5 gap-3">
        {/* Day headers */}
        {DAY_NAMES.slice(0, 5).map((name, i) => (
          <div
            key={name}
            className="text-center text-sm font-semibold py-2.5 rounded-lg text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/30"
          >
            <div>{name}</div>
            <div className="text-xs font-normal text-slate-400 dark:text-slate-500 mt-0.5">{formatDate(weekDays[i])}</div>
          </div>
        ))}

        {/* Day columns - only Mon-Fri */}
        {schedule.slice(0, 5).map((dayItems, dayIndex) => (
          <div
            key={dayIndex}
            onDragOver={(e) => handleDragOver(e, dayIndex)}
            onDragLeave={(e) => handleDragLeave(e, dayIndex)}
            onDrop={(e) => handleDrop(e, dayIndex)}
            className={`min-h-[160px] rounded-xl border p-2.5 transition-colors ${
              dragOverDay === dayIndex
                ? "bg-sky-50 dark:bg-sky-900/30 border-sky-300 dark:border-sky-600 ring-2 ring-sky-200 dark:ring-sky-700"
                : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
            }`}
          >
            {dayItems.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-600 text-center mt-10">
                {dragOverDay === dayIndex ? "Drop here" : "No content"}
              </p>
            )}
            {dayItems.map((item) => {
              const imgSrc = getItemThumbnail(item, images);
              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, dayIndex, item.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => setModalItem(item)}
                  className={`w-full text-left mb-2 last:mb-0 rounded-lg border p-2.5 transition-all hover:shadow-md hover:scale-[1.02] cursor-pointer active:cursor-grabbing ${item.color}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setModalItem(item);
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <div className="flex items-center gap-1.5">
                      <svg
                        className="w-3 h-3 opacity-40 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <circle cx="9" cy="5" r="1.5" />
                        <circle cx="15" cy="5" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" />
                        <circle cx="15" cy="12" r="1.5" />
                        <circle cx="9" cy="19" r="1.5" />
                        <circle cx="15" cy="19" r="1.5" />
                      </svg>
                      <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">{item.label}</span>
                    </div>
                    {imgSrc && (
                      <img src={imgSrc} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0 opacity-80" />
                    )}
                  </div>
                  <p className="text-xs font-semibold mt-0.5 line-clamp-2 leading-snug">{item.title}</p>
                  <p className="text-[11px] mt-1 opacity-70 line-clamp-2 leading-snug">{item.preview}</p>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4 justify-center">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border ${color}`}>
            {type}
          </div>
        ))}
      </div>
    </div>
  );
}
