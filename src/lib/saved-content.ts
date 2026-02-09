import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

function getUserDir(userId: string): string {
  if (userId === "default") return DATA_DIR;
  return path.join(DATA_DIR, userId);
}

function getSavedContentFile(userId: string, companyId: string): string {
  return path.join(getUserDir(userId), `saved-content-${companyId}.json`);
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

async function ensureUserDir(userId: string) {
  try {
    await fs.mkdir(getUserDir(userId), { recursive: true });
  } catch {
    // ignore
  }
}

export async function getSavedContent(userId: string, companyId: string): Promise<SavedContentItem[]> {
  try {
    await ensureUserDir(userId);
    const raw = await fs.readFile(getSavedContentFile(userId, companyId), "utf-8");
    const data = JSON.parse(raw) as SavedContentData;
    return data.items;
  } catch {
    return [];
  }
}

async function saveSavedContent(userId: string, companyId: string, items: SavedContentItem[]): Promise<void> {
  await ensureUserDir(userId);
  await fs.writeFile(
    getSavedContentFile(userId, companyId),
    JSON.stringify({ items }, null, 2),
    "utf-8"
  );
}

export async function addSavedContent(
  userId: string,
  companyId: string,
  name: string,
  theme: SavedContentItem["theme"],
  content: SavedContentItem["content"]
): Promise<SavedContentItem> {
  const items = await getSavedContent(userId, companyId);
  const item: SavedContentItem = {
    id: crypto.randomUUID(),
    name,
    theme,
    content,
    savedAt: new Date().toISOString(),
  };
  items.unshift(item);
  await saveSavedContent(userId, companyId, items);
  return item;
}

export async function deleteSavedContent(userId: string, companyId: string, id: string): Promise<boolean> {
  const items = await getSavedContent(userId, companyId);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  items.splice(index, 1);
  await saveSavedContent(userId, companyId, items);
  return true;
}

export async function updateSavedContent(
  userId: string,
  companyId: string,
  id: string,
  content: SavedContentItem["content"]
): Promise<boolean> {
  const items = await getSavedContent(userId, companyId);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  items[index].content = content;
  await saveSavedContent(userId, companyId, items);
  return true;
}
