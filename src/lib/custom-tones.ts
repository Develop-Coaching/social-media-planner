import { promises as fs } from "fs";
import path from "path";
import { CustomToneStyle } from "@/types";

const DATA_DIR = path.join(process.cwd(), "data");

function getUserDir(userId: string): string {
  return path.join(DATA_DIR, userId);
}

function getCustomTonesFile(userId: string, companyId: string): string {
  return path.join(getUserDir(userId), `custom-tones-${companyId}.json`);
}

async function ensureUserDir(userId: string) {
  try {
    await fs.mkdir(getUserDir(userId), { recursive: true });
  } catch {
    // ignore
  }
}

export async function getCustomTones(userId: string, companyId: string): Promise<CustomToneStyle[]> {
  try {
    await ensureUserDir(userId);
    const raw = await fs.readFile(getCustomTonesFile(userId, companyId), "utf-8");
    const data = JSON.parse(raw) as { tones: CustomToneStyle[] };
    return data.tones;
  } catch {
    return [];
  }
}

async function saveCustomTones(userId: string, companyId: string, tones: CustomToneStyle[]): Promise<void> {
  await ensureUserDir(userId);
  await fs.writeFile(
    getCustomTonesFile(userId, companyId),
    JSON.stringify({ tones }, null, 2),
    "utf-8"
  );
}

export async function addCustomTone(
  userId: string,
  companyId: string,
  label: string,
  prompt: string
): Promise<CustomToneStyle> {
  const tones = await getCustomTones(userId, companyId);
  const tone: CustomToneStyle = {
    id: crypto.randomUUID(),
    label,
    description: prompt.length > 60 ? prompt.slice(0, 57) + "..." : prompt,
    prompt,
    isCustom: true,
    createdAt: new Date().toISOString(),
  };
  tones.unshift(tone);
  await saveCustomTones(userId, companyId, tones);
  return tone;
}

export async function deleteCustomTone(userId: string, companyId: string, id: string): Promise<boolean> {
  const tones = await getCustomTones(userId, companyId);
  const index = tones.findIndex((t) => t.id === id);
  if (index === -1) return false;
  tones.splice(index, 1);
  await saveCustomTones(userId, companyId, tones);
  return true;
}
