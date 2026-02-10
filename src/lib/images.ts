import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { sanitizeId, validatePath } from "@/lib/sanitize";

const DATA_DIR = path.join(process.cwd(), "data");

function getUserDir(userId: string): string {
  if (userId === "default") return DATA_DIR;
  const dir = path.join(DATA_DIR, sanitizeId(userId));
  validatePath(dir, DATA_DIR);
  return dir;
}

function getImagesFile(userId: string, companyId: string): string {
  const filePath = path.join(getUserDir(userId), `images-${sanitizeId(companyId)}.json`);
  validatePath(filePath, DATA_DIR);
  return filePath;
}

async function ensureUserDir(userId: string) {
  try {
    await fs.mkdir(getUserDir(userId), { recursive: true });
  } catch {
    // ignore
  }
}

export async function getImages(userId: string, companyId: string): Promise<Record<string, string>> {
  try {
    await ensureUserDir(userId);
    const raw = await fs.readFile(getImagesFile(userId, companyId), "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function saveAllImages(userId: string, companyId: string, images: Record<string, string>): Promise<void> {
  await ensureUserDir(userId);
  await fs.writeFile(
    getImagesFile(userId, companyId),
    JSON.stringify(images),
    "utf-8"
  );
}

export async function saveImage(userId: string, companyId: string, key: string, dataUrl: string): Promise<void> {
  const images = await getImages(userId, companyId);
  images[key] = dataUrl;
  await saveAllImages(userId, companyId, images);
}

export async function deleteImage(userId: string, companyId: string, key: string): Promise<void> {
  const images = await getImages(userId, companyId);
  delete images[key];
  await saveAllImages(userId, companyId, images);
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
