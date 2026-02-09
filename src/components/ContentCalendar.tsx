"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GeneratedContent } from "@/types";

interface CalendarItem {
  id: string;
  type: string;
  label: string;
  title: string;
  preview: string;
  fullText: string;
  color: string;
}

interface Props {
  content: GeneratedContent;
  startDate: Date;
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
    })
  );
  content.reels.forEach((r, i) =>
    items.push({
      id: `reel-${i}`,
      type: "Reel",
      label: "Reel",
      title: `Reel ${i + 1}`,
      preview: r.script.slice(0, 80),
      fullText: r.script,
      color: TYPE_COLORS.Reel,
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
    })
  );
  content.carousels.forEach((c, i) =>
    items.push({
      id: `carousel-${i}`,
      type: "Carousel",
      label: "Carousel",
      title: c.slides[0]?.title || `Carousel ${i + 1}`,
      preview: c.slides.map((s) => s.title).join(" / "),
      fullText: c.slides.map((s) => `${s.title}: ${s.body}`).join("\n"),
      color: TYPE_COLORS.Carousel,
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

function distributeItems(items: CalendarItem[]): CalendarItem[][] {
  const schedule: CalendarItem[][] = Array.from({ length: 7 }, () => []);
  if (items.length === 0) return schedule;
  // Spread items evenly across 5 weekdays (Mon-Fri), weekends empty
  items.forEach((item, i) => {
    const dayIndex = i % 5;
    schedule[dayIndex].push(item);
  });
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

// ---------- Component ----------

export default function ContentCalendar({ content, startDate }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<CalendarItem[][]>(() => []);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);

  // Track which content + weekOffset we last distributed for
  const lastDistributedRef = useRef<string>("");

  const items = collectItems(content);
  const monday = getNextMonday(startDate);
  monday.setDate(monday.getDate() + weekOffset * 7);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Build a fingerprint from items + weekOffset so we know when to re-distribute
  const contentFingerprint = items.map((it) => it.id).join(",") + `|${weekOffset}`;

  useEffect(() => {
    if (lastDistributedRef.current !== contentFingerprint) {
      lastDistributedRef.current = contentFingerprint;
      setSchedule(distributeItems(items));
      setExpandedItem(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentFingerprint]);

  const totalItems = items.length;

  // ---------- Drag-and-drop handlers ----------

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, fromDay: number, itemId: string) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({ fromDay, itemId }));
      // Slight opacity on the dragged element
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
      // Only clear if we're actually leaving this day column (not entering a child)
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

      setSchedule((prev) => {
        const next = prev.map((dayItems) => [...dayItems]);
        const sourceIndex = next[fromDay].findIndex((it) => it.id === itemId);
        if (sourceIndex === -1) return prev;
        const [moved] = next[fromDay].splice(sourceIndex, 1);
        next[toDay].push(moved);
        return next;
      });
    },
    []
  );

  // ---------- ICS export ----------

  const handleExportICS = useCallback(() => {
    const icsStr = generateICS(schedule, weekDays);
    const startStr = toICSDateStr(weekDays[0]);
    downloadICS(icsStr, `content-calendar-${startStr}.ics`);
  }, [schedule, weekDays]);

  return (
    <div>
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

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-2">
        {/* Day headers */}
        {DAY_NAMES.map((name, i) => (
          <div
            key={name}
            className={`text-center text-xs font-semibold py-2 rounded-lg ${
              i >= 5 ? "text-slate-400 dark:text-slate-600" : "text-slate-600 dark:text-slate-300"
            }`}
          >
            <div>{name}</div>
            <div className="text-[10px] font-normal text-slate-400 dark:text-slate-500">{formatDate(weekDays[i])}</div>
          </div>
        ))}

        {/* Day columns */}
        {schedule.map((dayItems, dayIndex) => (
          <div
            key={dayIndex}
            onDragOver={(e) => handleDragOver(e, dayIndex)}
            onDragLeave={(e) => handleDragLeave(e, dayIndex)}
            onDrop={(e) => handleDrop(e, dayIndex)}
            className={`min-h-[120px] rounded-xl border p-2 transition-colors ${
              dragOverDay === dayIndex
                ? "bg-sky-50 dark:bg-sky-900/30 border-sky-300 dark:border-sky-600 ring-2 ring-sky-200 dark:ring-sky-700"
                : dayIndex >= 5
                  ? "bg-slate-50/50 dark:bg-slate-900/30 border-slate-100 dark:border-slate-800"
                  : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
            }`}
          >
            {dayItems.length === 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-600 text-center mt-6">
                {dragOverDay === dayIndex ? "Drop here" : dayIndex < 5 ? "No content" : ""}
              </p>
            )}
            {dayItems.map((item, itemIndex) => {
              const itemKey = `${dayIndex}-${item.id}`;
              const isExpanded = expandedItem === itemKey;
              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, dayIndex, item.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => setExpandedItem(isExpanded ? null : itemKey)}
                  className={`w-full text-left mb-1.5 last:mb-0 rounded-lg border p-2 transition-all hover:shadow-sm cursor-grab active:cursor-grabbing ${item.color}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedItem(isExpanded ? null : itemKey);
                    }
                  }}
                >
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
                  <p className="text-xs font-medium mt-0.5 line-clamp-2">{item.title}</p>
                  {isExpanded && (
                    <p className="text-[11px] mt-1.5 opacity-80 line-clamp-4">{item.preview}...</p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4 justify-center">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border ${color}`}>
            {type}
          </div>
        ))}
      </div>
    </div>
  );
}
