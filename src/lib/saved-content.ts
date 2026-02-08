import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

function getSavedContentFile(companyId: string): string {
  return path.join(DATA_DIR, `saved-content-${companyId}.json`);
}

export interface SavedContentItem {
  id: string;
  name: string;
  theme: { id: string; title: string; description: string };
  content: {
    posts: { title: string; caption: string; imagePrompt: string }[];
    reels: { script: string; imagePrompt?: string }[];
    linkedinArticles: { title: string; caption: string; body: string; imagePrompt: string }[];
    carousels: { slides: { title: string; body: string }[]; imagePrompt: string }[];
    quotesForX: { quote: string; imagePrompt: string }[];
    youtube: { title: string; script: string; thumbnailPrompt?: string }[];
  };
  savedAt: string;
}

export interface SavedContentData {
  items: SavedContentItem[];
}

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

export async function getSavedContent(companyId: string): Promise<SavedContentItem[]> {
  try {
    await ensureDataDir();
    const raw = await fs.readFile(getSavedContentFile(companyId), "utf-8");
    const data = JSON.parse(raw) as SavedContentData;
    return data.items;
  } catch {
    return [];
  }
}

async function saveSavedContent(companyId: string, items: SavedContentItem[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(
    getSavedContentFile(companyId),
    JSON.stringify({ items }, null, 2),
    "utf-8"
  );
}

export async function addSavedContent(
  companyId: string,
  name: string,
  theme: SavedContentItem["theme"],
  content: SavedContentItem["content"]
): Promise<SavedContentItem> {
  const items = await getSavedContent(companyId);
  const item: SavedContentItem = {
    id: crypto.randomUUID(),
    name,
    theme,
    content,
    savedAt: new Date().toISOString(),
  };
  items.unshift(item); // Add to beginning
  await saveSavedContent(companyId, items);
  return item;
}

export async function deleteSavedContent(companyId: string, id: string): Promise<boolean> {
  const items = await getSavedContent(companyId);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  items.splice(index, 1);
  await saveSavedContent(companyId, items);
  return true;
}

export async function updateSavedContent(
  companyId: string,
  id: string,
  content: SavedContentItem["content"]
): Promise<boolean> {
  const items = await getSavedContent(companyId);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  items[index].content = content;
  await saveSavedContent(companyId, items);
  return true;
}
