import { supabase } from "@/lib/supabase";

export interface MemoryFile {
  id: string;
  name: string;
  content: string;
  addedAt: string;
}

export interface Memory {
  files: MemoryFile[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToMemoryFile(row: any): MemoryFile {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    addedAt: row.added_at,
  };
}

export async function getMemory(userId: string, companyId: string): Promise<Memory> {
  const { data, error } = await supabase
    .from("memory_files")
    .select("*")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .order("added_at", { ascending: true });
  if (error || !data) return { files: [] };
  return { files: data.map(rowToMemoryFile) };
}

export async function saveMemory(userId: string, companyId: string, memory: Memory): Promise<void> {
  // Delete existing and re-insert all
  await supabase
    .from("memory_files")
    .delete()
    .eq("user_id", userId)
    .eq("company_id", companyId);

  if (memory.files.length > 0) {
    const rows = memory.files.map((f) => ({
      id: f.id,
      user_id: userId,
      company_id: companyId,
      name: f.name,
      content: f.content,
      added_at: f.addedAt,
    }));
    await supabase.from("memory_files").insert(rows);
  }
}

export async function addToMemory(userId: string, companyId: string, name: string, content: string): Promise<MemoryFile> {
  const id = crypto.randomUUID();
  const addedAt = new Date().toISOString();

  await supabase.from("memory_files").insert({
    id,
    user_id: userId,
    company_id: companyId,
    name,
    content: content.slice(0, 200_000),
    added_at: addedAt,
  });

  return { id, name, content: content.slice(0, 200_000), addedAt };
}

export async function removeFromMemory(userId: string, companyId: string, id: string): Promise<boolean> {
  const { error } = await supabase
    .from("memory_files")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .eq("company_id", companyId);
  return !error;
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
