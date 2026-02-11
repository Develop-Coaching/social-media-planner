import { supabase } from "@/lib/supabase";

const BUCKET = "content-images";

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
  completedAt?: string;
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
    completedAt: row.completed_at || undefined,
  };
}

async function cleanupExpiredContent(userId: string, companyId: string): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: expired } = await supabase
    .from("saved_content")
    .select("id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .lt("completed_at", thirtyDaysAgo);

  if (!expired?.length) return;

  for (const item of expired) {
    // Delete Storage files for this saved content
    const prefix = `${userId}/${companyId}/${item.id}/`;
    const { data: files } = await supabase.storage.from(BUCKET).list(prefix.slice(0, -1));
    if (files?.length) {
      const paths = files.map((f) => `${prefix}${f.name}`);
      await supabase.storage.from(BUCKET).remove(paths);
    }
  }

  // Bulk delete expired rows (CASCADE handles images table)
  const expiredIds = expired.map((e) => e.id);
  await supabase
    .from("saved_content")
    .delete()
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .in("id", expiredIds);
}

export async function getSavedContent(userId: string, companyId: string): Promise<SavedContentItem[]> {
  // Clean up expired completed content first
  await cleanupExpiredContent(userId, companyId);

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
  // Clean up Storage files for this saved content before DB delete
  const prefix = `${userId}/${companyId}/${id}/`;
  const { data: files } = await supabase.storage.from(BUCKET).list(`${userId}/${companyId}/${id}`);
  if (files?.length) {
    const paths = files.map((f) => `${prefix}${f.name}`);
    await supabase.storage.from(BUCKET).remove(paths);
  }

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
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  return !error;
}
