"use client";

import { useState, useRef, useEffect } from "react";

const POPULAR_FONTS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins",
  "Nunito", "Raleway", "Playfair Display", "Merriweather",
  "Source Sans 3", "PT Sans", "Oswald", "Quicksand", "Work Sans",
  "Rubik", "Mulish", "Barlow", "Cabin", "DM Sans",
  "Karla", "Manrope", "Outfit", "Plus Jakarta Sans", "Space Grotesk",
  "Urbanist", "Sora", "Lexend", "Figtree", "Geist",
  "Libre Baskerville", "Crimson Text", "Cormorant Garamond", "EB Garamond",
  "Bitter", "Josefin Sans", "Comfortaa", "Pacifico", "Dancing Script", "Caveat",
];

interface Props {
  value: string;
  onChange: (font: string) => void;
}

export default function FontPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? POPULAR_FONTS.filter((f) => f.toLowerCase().includes(query.toLowerCase()))
    : POPULAR_FONTS;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Load preview font
  useEffect(() => {
    if (!value) { setPreviewLoaded(false); return; }
    const id = "font-picker-preview";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(value)}&display=swap`;
    link.onload = () => setPreviewLoaded(true);
  }, [value]);

  function selectFont(font: string) {
    setQuery(font);
    setOpen(false);
    onChange(font);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setOpen(true);
  }

  function handleBlur() {
    // Allow clicking dropdown items before blur fires
    setTimeout(() => {
      if (!wrapperRef.current?.contains(document.activeElement)) {
        setOpen(false);
        // If typed value differs from current, treat as custom font
        if (query.trim() && query.trim() !== value) {
          onChange(query.trim());
        }
      }
    }, 150);
  }

  function handleClear() {
    setQuery("");
    onChange("");
  }

  return (
    <div>
      <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-3">Font Family</h4>
      <div ref={wrapperRef} className="relative">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={() => setOpen(true)}
            onBlur={handleBlur}
            placeholder="Search Google Fonts..."
            className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-shadow"
          />
          {value && (
            <button
              onClick={handleClear}
              className="px-3 py-2 rounded-xl text-sm text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 border border-slate-300 dark:border-slate-600 hover:border-red-300 dark:hover:border-red-500 transition-colors"
              title="Reset to default font"
            >
              Clear
            </button>
          )}
        </div>

        {open && filtered.length > 0 && (
          <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl">
            {filtered.map((font) => (
              <button
                key={font}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectFont(font)}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-brand-primary-light transition-colors ${
                  font === value ? "text-brand-primary font-medium" : "text-slate-700 dark:text-slate-300"
                }`}
              >
                {font}
              </button>
            ))}
          </div>
        )}
      </div>

      {value && previewLoaded && (
        <p
          className="mt-3 text-sm text-slate-600 dark:text-slate-400"
          style={{ fontFamily: `"${value}", sans-serif` }}
        >
          The quick brown fox jumps over the lazy dog
        </p>
      )}
      <p className="text-xs text-slate-400 mt-1">
        Select from popular fonts or type any Google Font name.
      </p>
    </div>
  );
}
