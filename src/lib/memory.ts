import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

function getUserDir(userId: string): string {
  if (userId === "default") return DATA_DIR;
  return path.join(DATA_DIR, userId);
}

function getMemoryFile(userId: string, companyId: string): string {
  return path.join(getUserDir(userId), `memory-${companyId}.json`);
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

async function ensureUserDir(userId: string) {
  try {
    await fs.mkdir(getUserDir(userId), { recursive: true });
  } catch {
    // ignore
  }
}

export async function getMemory(userId: string, companyId: string): Promise<Memory> {
  try {
    await ensureUserDir(userId);
    const raw = await fs.readFile(getMemoryFile(userId, companyId), "utf-8");
    return JSON.parse(raw) as Memory;
  } catch {
    return { ...defaultMemory };
  }
}

export async function saveMemory(userId: string, companyId: string, memory: Memory): Promise<void> {
  await ensureUserDir(userId);
  await fs.writeFile(getMemoryFile(userId, companyId), JSON.stringify(memory, null, 2), "utf-8");
}

export async function addToMemory(userId: string, companyId: string, name: string, content: string): Promise<MemoryFile> {
  const mem = await getMemory(userId, companyId);
  const file: MemoryFile = {
    id: crypto.randomUUID(),
    name,
    content: content.slice(0, 200_000),
    addedAt: new Date().toISOString(),
  };
  mem.files.push(file);
  await saveMemory(userId, companyId, mem);
  return file;
}

export async function removeFromMemory(userId: string, companyId: string, id: string): Promise<boolean> {
  const mem = await getMemory(userId, companyId);
  const index = mem.files.findIndex((f) => f.id === id);
  if (index === -1) return false;
  mem.files.splice(index, 1);
  await saveMemory(userId, companyId, mem);
  return true;
}

export async function getContextForAI(userId: string, companyId: string): Promise<string> {
  const mem = await getMemory(userId, companyId);
  if (mem.files.length === 0) {
    return "No files have been added to memory yet. The user has not provided any context.";
  }
  return mem.files
    .map(
      (f) => `--- File: ${f.name} (added ${f.addedAt}) ---\n${f.content}\n`
    )
    .join("\n");
}
