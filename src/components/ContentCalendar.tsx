"use client";

import { useState } from "react";
import { GeneratedContent } from "@/types";

interface CalendarItem {
  type: string;
  label: string;
  title: string;
  preview: string;
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
  content.posts.forEach((p) => items.push({ type: "Post", label: "Post", title: p.title, preview: p.caption.slice(0, 80), color: TYPE_COLORS.Post }));
  content.reels.forEach((r, i) => items.push({ type: "Reel", label: "Reel", title: `Reel ${i + 1}`, preview: r.script.slice(0, 80), color: TYPE_COLORS.Reel }));
  content.linkedinArticles.forEach((a) => items.push({ type: "Article", label: "Article", title: a.title, preview: a.caption || a.body.slice(0, 80), color: TYPE_COLORS.Article }));
  content.carousels.forEach((c, i) => items.push({ type: "Carousel", label: "Carousel", title: c.slides[0]?.title || `Carousel ${i + 1}`, preview: c.slides.map((s) => s.title).join(" / "), color: TYPE_COLORS.Carousel }));
  content.quotesForX.forEach((q) => items.push({ type: "Quote", label: "Quote (X)", title: q.quote.slice(0, 40), preview: q.quote, color: TYPE_COLORS.Quote }));
  content.youtube.forEach((y) => items.push({ type: "YouTube", label: "YouTube", title: y.title, preview: y.script.slice(0, 80), color: TYPE_COLORS.YouTube }));
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

function distributeItems(items: CalendarItem[], days: number): CalendarItem[][] {
  const schedule: CalendarItem[][] = Array.from({ length: days }, () => []);
  if (items.length === 0) return schedule;

  // Spread items evenly across available days
  items.forEach((item, i) => {
    const dayIndex = i % days;
    schedule[dayIndex].push(item);
  });
  return schedule;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ContentCalendar({ content, startDate }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const items = collectItems(content);
  const monday = getNextMonday(startDate);
  monday.setDate(monday.getDate() + weekOffset * 7);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Distribute across 5 weekdays (Mon-Fri) by default, leaving weekends lighter
  const weekdayItems = distributeItems(items, 5);
  const schedule: CalendarItem[][] = [...weekdayItems, [], []];

  const totalItems = items.length;

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
        <button
          onClick={() => setWeekOffset((o) => o + 1)}
          className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
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
            className={`min-h-[120px] rounded-xl border p-2 ${
              dayIndex >= 5
                ? "bg-slate-50/50 dark:bg-slate-900/30 border-slate-100 dark:border-slate-800"
                : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
            }`}
          >
            {dayItems.length === 0 && dayIndex < 5 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-600 text-center mt-6">No content</p>
            )}
            {dayItems.map((item, itemIndex) => {
              const itemKey = `${dayIndex}-${itemIndex}`;
              const isExpanded = expandedItem === itemKey;
              return (
                <button
                  key={itemIndex}
                  onClick={() => setExpandedItem(isExpanded ? null : itemKey)}
                  className={`w-full text-left mb-1.5 last:mb-0 rounded-lg border p-2 transition-all hover:shadow-sm ${item.color}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">{item.label}</span>
                  </div>
                  <p className="text-xs font-medium mt-0.5 line-clamp-2">{item.title}</p>
                  {isExpanded && (
                    <p className="text-[11px] mt-1.5 opacity-80 line-clamp-4">{item.preview}...</p>
                  )}
                </button>
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
