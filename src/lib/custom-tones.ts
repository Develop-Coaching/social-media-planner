import { promises as fs } from "fs";
import path from "path";
import { CustomToneStyle } from "@/types";

const DATA_DIR = path.join(process.cwd(), "data");

function getCustomTonesFile(companyId: string): string {
  return path.join(DATA_DIR, `custom-tones-${companyId}.json`);
}

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

export async function getCustomTones(companyId: string): Promise<CustomToneStyle[]> {
  try {
    await ensureDataDir();
    const raw = await fs.readFile(getCustomTonesFile(companyId), "utf-8");
    const data = JSON.parse(raw) as { tones: CustomToneStyle[] };
    return data.tones;
  } catch {
    return [];
  }
}

async function saveCustomTones(companyId: string, tones: CustomToneStyle[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(
    getCustomTonesFile(companyId),
    JSON.stringify({ tones }, null, 2),
    "utf-8"
  );
}

export async function addCustomTone(
  companyId: string,
  label: string,
  prompt: string
): Promise<CustomToneStyle> {
  const tones = await getCustomTones(companyId);
  const tone: CustomToneStyle = {
    id: crypto.randomUUID(),
    label,
    description: prompt.length > 60 ? prompt.slice(0, 57) + "..." : prompt,
    prompt,
    isCustom: true,
    createdAt: new Date().toISOString(),
  };
  tones.unshift(tone);
  await saveCustomTones(companyId, tones);
  return tone;
}

export async function deleteCustomTone(companyId: string, id: string): Promise<boolean> {
  const tones = await getCustomTones(companyId);
  const index = tones.findIndex((t) => t.id === id);
  if (index === -1) return false;
  tones.splice(index, 1);
  await saveCustomTones(companyId, tones);
  return true;
}
