import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

function getMemoryFile(companyId: string): string {
  return path.join(DATA_DIR, `memory-${companyId}.json`);
}

export interface MemoryFile {
  id: string;
  name: string;
  content: string;
  addedAt: string;
}

export interface Memory {
  files: MemoryFile[];
}

const defaultMemory: Memory = { files: [] };

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

export async function getMemory(companyId: string): Promise<Memory> {
  try {
    await ensureDataDir();
    const raw = await fs.readFile(getMemoryFile(companyId), "utf-8");
    return JSON.parse(raw) as Memory;
  } catch {
    return { ...defaultMemory };
  }
}

export async function saveMemory(companyId: string, memory: Memory): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(getMemoryFile(companyId), JSON.stringify(memory, null, 2), "utf-8");
}

export async function addToMemory(companyId: string, name: string, content: string): Promise<MemoryFile> {
  const mem = await getMemory(companyId);
  const file: MemoryFile = {
    id: crypto.randomUUID(),
    name,
    content: content.slice(0, 200_000),
    addedAt: new Date().toISOString(),
  };
  mem.files.push(file);
  await saveMemory(companyId, mem);
  return file;
}

export async function removeFromMemory(companyId: string, id: string): Promise<boolean> {
  const mem = await getMemory(companyId);
  const index = mem.files.findIndex((f) => f.id === id);
  if (index === -1) return false;
  mem.files.splice(index, 1);
  await saveMemory(companyId, mem);
  return true;
}

export async function getContextForAI(companyId: string): Promise<string> {
  const mem = await getMemory(companyId);
  if (mem.files.length === 0) {
    return "No files have been added to memory yet. The user has not provided any context.";
  }
  return mem.files
    .map(
      (f) => `--- File: ${f.name} (added ${f.addedAt}) ---\n${f.content}\n`
    )
    .join("\n");
}
