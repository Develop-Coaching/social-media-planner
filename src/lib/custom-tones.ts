import { CustomToneStyle } from "@/types";
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTone(row: any): CustomToneStyle {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    prompt: row.prompt,
    isCustom: true,
    createdAt: row.created_at,
  };
}

export async function getCustomTones(userId: string, companyId: string): Promise<CustomToneStyle[]> {
  const { data, error } = await supabase
    .from("custom_tones")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(rowToTone);
}

export async function addCustomTone(
  userId: string,
  companyId: string,
  label: string,
  prompt: string
): Promise<CustomToneStyle> {
  const id = crypto.randomUUID();
  const description = prompt.length > 60 ? prompt.slice(0, 57) + "..." : prompt;
  const createdAt = new Date().toISOString();

  await supabase.from("custom_tones").insert({
    id,
    user_id: userId,
    company_id: companyId,
    label,
    description,
    prompt,
    created_at: createdAt,
  });

  return { id, label, description, prompt, isCustom: true, createdAt };
}

export async function deleteCustomTone(userId: string, companyId: string, id: string): Promise<boolean> {
  const { error } = await supabase
    .from("custom_tones")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  return !error;
}
