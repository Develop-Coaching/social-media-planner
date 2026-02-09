export type Company = { id: string; name: string; logo?: string; brandColors?: string[] };
export type MemoryFile = { id: string; name: string; content: string; addedAt: string };
export type Theme = { id: string; title: string; description: string };
export type ContentCounts = {
  posts: number;
  reels: number;
  linkedinArticles: number;
  carousels: number;
  quotesForX: number;
  youtube: number;
};
export type GeneratedContent = {
  posts: { title: string; caption: string; imagePrompt: string }[];
  reels: { script: string; imagePrompt?: string }[];
  linkedinArticles: { title: string; caption: string; body: string; imagePrompt: string }[];
  carousels: { slides: { title: string; body: string }[]; imagePrompt: string }[];
  quotesForX: { quote: string; imagePrompt: string }[];
  youtube: { title: string; script: string; thumbnailPrompt?: string }[];
};
export type SavedContentItem = {
  id: string;
  name: string;
  theme: Theme;
  content: GeneratedContent;
  savedAt: string;
};

export type ToneStyle = {
  id: string;
  label: string;
  description: string;
  prompt: string;
};

export type CustomToneStyle = ToneStyle & {
  isCustom: true;
  createdAt: string;
};

export const toneOptions: ToneStyle[] = [
  { id: "professional", label: "Professional", description: "Polished & authoritative", prompt: "Write in a professional, authoritative tone. Use clear, confident language suitable for business audiences." },
  { id: "conversational", label: "Conversational", description: "Friendly & approachable", prompt: "Write in a warm, conversational tone like talking to a friend. Use casual language, contractions, and a relatable voice." },
  { id: "inspirational", label: "Inspirational", description: "Motivating & uplifting", prompt: "Write in an inspirational, motivating tone. Use empowering language that encourages action and positive change." },
  { id: "educational", label: "Educational", description: "Informative & clear", prompt: "Write in an educational, informative tone. Focus on clarity, practical tips, and actionable takeaways. Explain concepts simply." },
  { id: "bold", label: "Bold & Direct", description: "Punchy & no-nonsense", prompt: "Write in a bold, direct tone. Use short punchy sentences, strong opinions, and confident assertions. No fluff." },
  { id: "storytelling", label: "Storytelling", description: "Narrative & engaging", prompt: "Write in a storytelling tone. Use anecdotes, vivid descriptions, and narrative arcs to engage the reader emotionally." },
  { id: "humorous", label: "Humorous", description: "Witty & lighthearted", prompt: "Write in a humorous, witty tone. Use clever wordplay, light sarcasm, and relatable humor while still delivering value." },
];

export const defaultCounts: ContentCounts = {
  posts: 2,
  reels: 1,
  linkedinArticles: 0,
  carousels: 1,
  quotesForX: 2,
  youtube: 0,
};
