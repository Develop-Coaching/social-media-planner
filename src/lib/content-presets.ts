import { CustomContentPreset, ContentCounts } from "@/types";
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPreset(row: any): CustomContentPreset {
  return {
    id: row.id,
    label: row.label,
    counts: row.counts as ContentCounts,
    isCustom: true,
    createdAt: row.created_at,
  };
}

export async function getContentPresets(userId: string, companyId: string): Promise<CustomContentPreset[]> {
  const { data, error } = await supabase
    .from("content_presets")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(rowToPreset);
}

export async function addContentPreset(
  userId: string,
  companyId: string,
  label: string,
  counts: ContentCounts
): Promise<CustomContentPreset> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await supabase.from("content_presets").insert({
    id,
    user_id: userId,
    company_id: companyId,
    label,
    counts,
    created_at: createdAt,
  });

  return { id, label, counts, isCustom: true, createdAt };
}

export async function deleteContentPreset(userId: string, companyId: string, id: string): Promise<boolean> {
  const { error } = await supabase
    .from("content_presets")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  return !error;
}
