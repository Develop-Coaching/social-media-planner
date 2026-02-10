import crypto from "crypto";
import { supabase } from "@/lib/supabase";

const BUCKET = "content-images";

function storagePath(userId: string, companyId: string, key: string): string {
  return `${userId}/${companyId}/${key}.png`;
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return { mime: "image/png", buffer: Buffer.from(dataUrl, "base64") };
  }
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function getImages(userId: string, companyId: string): Promise<Record<string, string>> {
  const { data: rows, error } = await supabase
    .from("images")
    .select("key, storage_path, mime_type")
    .eq("user_id", userId)
    .eq("company_id", companyId);

  if (error || !rows?.length) return {};

  const result: Record<string, string> = {};
  for (const row of rows) {
    const { data, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(row.storage_path);
    if (dlError || !data) continue;
    const arrayBuffer = await data.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    result[row.key] = `data:${row.mime_type};base64,${base64}`;
  }

  return result;
}

export async function saveAllImages(userId: string, companyId: string, images: Record<string, string>): Promise<void> {
  // Delete all existing images for this company from Storage
  const { data: existing } = await supabase
    .from("images")
    .select("storage_path")
    .eq("user_id", userId)
    .eq("company_id", companyId);

  if (existing?.length) {
    const paths = existing.map((r) => r.storage_path);
    await supabase.storage.from(BUCKET).remove(paths);
  }

  // Delete all DB rows
  await supabase
    .from("images")
    .delete()
    .eq("user_id", userId)
    .eq("company_id", companyId);

  // Upload each image
  const entries = Object.entries(images);
  for (const [key, dataUrl] of entries) {
    const path = storagePath(userId, companyId, key);
    const { mime, buffer } = parseDataUrl(dataUrl);

    await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mime,
      upsert: true,
    });

    await supabase.from("images").insert({
      user_id: userId,
      company_id: companyId,
      key,
      storage_path: path,
      mime_type: mime,
    });
  }
}

export async function saveImage(userId: string, companyId: string, key: string, dataUrl: string): Promise<void> {
  const path = storagePath(userId, companyId, key);
  const { mime, buffer } = parseDataUrl(dataUrl);

  await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: true,
  });

  await supabase.from("images").upsert({
    user_id: userId,
    company_id: companyId,
    key,
    storage_path: path,
    mime_type: mime,
  }, { onConflict: "user_id,company_id,key" });
}

export async function deleteImage(userId: string, companyId: string, key: string): Promise<void> {
  const path = storagePath(userId, companyId, key);
  await supabase.storage.from(BUCKET).remove([path]);
  await supabase
    .from("images")
    .delete()
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .eq("key", key);
}

export function signImageParams(
  userId: string,
  companyId: string,
  key: string,
  expires: number
): string {
  const secret = process.env.AUTH_SECRET || "post-creator-default-secret-change-me";
  const data = `${userId}:${companyId}:${key}:${expires}`;
  return crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("hex");
}
