"use client";

import { useState, useRef, useCallback } from "react";
import { Character } from "@/types";

interface Props {
  characters: Character[];
  loading: boolean;
  onAdd: () => void;
  onUpdate: (characterId: string, updates: { name?: string; description?: string }) => void;
  onDelete: (characterId: string) => void;
  onUploadImage: (characterId: string, dataUrl: string) => void;
  onRemoveImage: (characterId: string) => void;
}

function CharacterCard({
  character,
  onUpdate,
  onDelete,
  onUploadImage,
  onRemoveImage,
}: {
  character: Character;
  onUpdate: (characterId: string, updates: { name?: string; description?: string }) => void;
  onDelete: (characterId: string) => void;
  onUploadImage: (characterId: string, dataUrl: string) => void;
  onRemoveImage: (characterId: string) => void;
}) {
  const [name, setName] = useState(character.name);
  const [description, setDescription] = useState(character.description);
  const nameTimerRef = useRef<NodeJS.Timeout | null>(null);
  const descTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const debouncedUpdateName = useCallback(
    (val: string) => {
      if (nameTimerRef.current) clearTimeout(nameTimerRef.current);
      nameTimerRef.current = setTimeout(() => onUpdate(character.id, { name: val }), 800);
    },
    [character.id, onUpdate]
  );

  const debouncedUpdateDesc = useCallback(
    (val: string) => {
      if (descTimerRef.current) clearTimeout(descTimerRef.current);
      descTimerRef.current = setTimeout(() => onUpdate(character.id, { description: val }), 800);
    },
    [character.id, onUpdate]
  );

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Image must be under 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onUploadImage(character.id, reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
      <div className="flex items-start gap-4">
        {/* Image thumbnail */}
        <div className="flex-shrink-0">
          {character.imageUrl ? (
            <div className="relative group">
              <img
                src={character.imageUrl}
                alt={character.name}
                className="w-20 h-20 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
              />
              <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title="Replace image"
                  className="p-1.5 rounded-md bg-white/20 hover:bg-white/30 text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                <button
                  onClick={() => onRemoveImage(character.id)}
                  title="Remove image"
                  className="p-1.5 rounded-md bg-white/20 hover:bg-red-500/60 text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 hover:border-brand-primary hover:text-brand-primary transition-colors"
              title="Upload reference image"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-[10px] mt-0.5">Add photo</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>

        {/* Name + Description */}
        <div className="flex-1 min-w-0 space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              debouncedUpdateName(e.target.value);
            }}
            onBlur={() => {
              if (nameTimerRef.current) clearTimeout(nameTimerRef.current);
              if (name !== character.name) onUpdate(character.id, { name });
            }}
            placeholder="Character name"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 font-medium focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-shadow"
          />
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              debouncedUpdateDesc(e.target.value);
            }}
            onBlur={() => {
              if (descTimerRef.current) clearTimeout(descTimerRef.current);
              if (description !== character.description) onUpdate(character.id, { description });
            }}
            placeholder="Describe this character's appearance for image generation..."
            rows={2}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 resize-y focus:ring-2 focus:ring-brand-primary focus:border-transparent transition-shadow"
          />
        </div>

        {/* Delete button */}
        <button
          onClick={() => onDelete(character.id)}
          title="Delete character"
          className="flex-shrink-0 p-2 rounded-lg text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function CharacterManager({ characters, loading, onAdd, onUpdate, onDelete, onUploadImage, onRemoveImage }: Props) {
  if (loading) {
    return (
      <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
        <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-3">Characters / Avatars</h4>
        <div className="animate-pulse space-y-3">
          <div className="h-24 rounded-xl bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-medium text-slate-700 dark:text-slate-300">Characters / Avatars</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Add recurring characters for consistent image generation. Upload reference photos for best results.
          </p>
        </div>
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Character
        </button>
      </div>

      {characters.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 p-6 text-center">
          <svg className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No characters yet. Add a character to include consistent people or mascots in your generated images.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {characters.map((char) => (
            <CharacterCard
              key={char.id}
              character={char}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onUploadImage={onUploadImage}
              onRemoveImage={onRemoveImage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
