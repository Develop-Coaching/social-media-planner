import { supabase } from "@/lib/supabase";

export interface SavedContentItem {
  id: string;
  name: string;
  theme: { id: string; title: string; description: string };
  content: {
    posts: { title: string; caption: string; imagePrompt: string }[];
    reels: { script: string; caption: string }[];
    linkedinArticles: { title: string; caption: string; body: string; imagePrompt: string }[];
    carousels: { slides: { title: string; body: string }[]; imagePrompt: string }[];
    quotesForX: { quote: string; imagePrompt: string }[];
    youtube: { title: string; script: string; thumbnailPrompt?: string }[];
  };
  savedAt: string;
  status?: "active" | "completed";
}

export interface SavedContentData {
  items: SavedContentItem[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToItem(row: any): SavedContentItem {
  return {
    id: row.id,
    name: row.name,
    theme: row.theme,
    content: row.content,
    savedAt: row.saved_at,
    status: row.status || "active",
  };
}

export async function getSavedContent(userId: string, companyId: string): Promise<SavedContentItem[]> {
  const { data, error } = await supabase
    .from("saved_content")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .order("saved_at", { ascending: false });
  if (error || !data) return [];
  return data.map(rowToItem);
}

export async function addSavedContent(
  userId: string,
  companyId: string,
  name: string,
  theme: SavedContentItem["theme"],
  content: SavedContentItem["content"]
): Promise<SavedContentItem> {
  const id = crypto.randomUUID();
  const savedAt = new Date().toISOString();

  await supabase.from("saved_content").insert({
    id,
    user_id: userId,
    company_id: companyId,
    name,
    theme,
    content,
    saved_at: savedAt,
  });

  return { id, name, theme, content, savedAt };
}

export async function deleteSavedContent(userId: string, companyId: string, id: string): Promise<boolean> {
  const { error } = await supabase
    .from("saved_content")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  return !error;
}

export async function updateSavedContent(
  userId: string,
  companyId: string,
  id: string,
  content: SavedContentItem["content"]
): Promise<boolean> {
  const { error } = await supabase
    .from("saved_content")
    .update({ content })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  return !error;
}

export async function markCompleted(
  userId: string,
  companyId: string,
  id: string
): Promise<boolean> {
  const { error } = await supabase
    .from("saved_content")
    .update({ status: "completed" })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  return !error;
}
