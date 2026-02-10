import { supabase } from "@/lib/supabase";

const BUCKET = "content-images";

export interface Character {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  imageMimeType?: string;
  createdAt: string;
}

function storagePath(userId: string, companyId: string, characterId: string, ext: string): string {
  return `${userId}/${companyId}/characters/${characterId}.${ext}`;
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer; ext: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return { mime: "image/png", buffer: Buffer.from(dataUrl, "base64"), ext: "png" };
  }
  const mime = match[1];
  const ext = mime.split("/")[1] || "png";
  return { mime, buffer: Buffer.from(match[2], "base64"), ext };
}

export async function getCharacters(userId: string, companyId: string): Promise<Character[]> {
  const { data: rows, error } = await supabase
    .from("characters")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });

  if (error || !rows?.length) return [];

  const characters: Character[] = [];
  for (const row of rows) {
    const char: Character = {
      id: row.id,
      name: row.name,
      description: row.description || "",
      createdAt: row.created_at,
    };

    if (row.image_storage_path) {
      const { data, error: dlError } = await supabase.storage
        .from(BUCKET)
        .download(row.image_storage_path);
      if (!dlError && data) {
        const arrayBuffer = await data.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        char.imageUrl = `data:${row.image_mime_type || "image/png"};base64,${base64}`;
        char.imageMimeType = row.image_mime_type || "image/png";
      }
    }

    characters.push(char);
  }

  return characters;
}

export async function addCharacter(userId: string, companyId: string, name: string, description: string): Promise<Character> {
  const { data, error } = await supabase
    .from("characters")
    .insert({
      user_id: userId,
      company_id: companyId,
      name,
      description,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Failed to add character");

  return {
    id: data.id,
    name: data.name,
    description: data.description || "",
    createdAt: data.created_at,
  };
}

export async function updateCharacter(
  userId: string,
  companyId: string,
  characterId: string,
  updates: { name?: string; description?: string }
): Promise<Character | null> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.description !== undefined) dbUpdates.description = updates.description;

  const { data, error } = await supabase
    .from("characters")
    .update(dbUpdates)
    .eq("id", characterId)
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (error || !data) return null;

  const char: Character = {
    id: data.id,
    name: data.name,
    description: data.description || "",
    createdAt: data.created_at,
  };

  // Re-fetch image if it exists
  if (data.image_storage_path) {
    const { data: imgData, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(data.image_storage_path);
    if (!dlError && imgData) {
      const arrayBuffer = await imgData.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      char.imageUrl = `data:${data.image_mime_type || "image/png"};base64,${base64}`;
      char.imageMimeType = data.image_mime_type || "image/png";
    }
  }

  return char;
}

export async function uploadCharacterImage(
  userId: string,
  companyId: string,
  characterId: string,
  dataUrl: string
): Promise<void> {
  const { mime, buffer, ext } = parseDataUrl(dataUrl);
  const path = storagePath(userId, companyId, characterId, ext);

  // Remove old image if any
  const { data: row } = await supabase
    .from("characters")
    .select("image_storage_path")
    .eq("id", characterId)
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .single();

  if (row?.image_storage_path) {
    await supabase.storage.from(BUCKET).remove([row.image_storage_path]);
  }

  await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: true,
  });

  await supabase
    .from("characters")
    .update({ image_storage_path: path, image_mime_type: mime })
    .eq("id", characterId)
    .eq("user_id", userId)
    .eq("company_id", companyId);
}

export async function deleteCharacterImage(
  userId: string,
  companyId: string,
  characterId: string
): Promise<void> {
  const { data: row } = await supabase
    .from("characters")
    .select("image_storage_path")
    .eq("id", characterId)
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .single();

  if (row?.image_storage_path) {
    await supabase.storage.from(BUCKET).remove([row.image_storage_path]);
  }

  await supabase
    .from("characters")
    .update({ image_storage_path: null, image_mime_type: null })
    .eq("id", characterId)
    .eq("user_id", userId)
    .eq("company_id", companyId);
}

export async function deleteCharacter(
  userId: string,
  companyId: string,
  characterId: string
): Promise<boolean> {
  // Remove image from Storage first
  const { data: row } = await supabase
    .from("characters")
    .select("image_storage_path")
    .eq("id", characterId)
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .single();

  if (row?.image_storage_path) {
    await supabase.storage.from(BUCKET).remove([row.image_storage_path]);
  }

  const { error } = await supabase
    .from("characters")
    .delete()
    .eq("id", characterId)
    .eq("user_id", userId)
    .eq("company_id", companyId);

  return !error;
}
