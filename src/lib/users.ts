import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: "admin" | "user";
  createdAt: string;
  createdBy: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function getUsers(): Promise<Omit<User, "passwordHash">[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id, username, display_name, role, created_at, created_by");
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    createdBy: row.created_by,
  }));
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .ilike("username", username)
    .single();
  if (error || !data) return null;
  return rowToUser(data);
}

export async function getUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return rowToUser(data);
}

export async function createUser(
  username: string,
  displayName: string,
  password: string,
  role: "admin" | "user",
  createdBy: string | null
): Promise<Omit<User, "passwordHash">> {
  const existing = await getUserByUsername(username);
  if (existing) {
    throw new Error("Username already exists");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const { error } = await supabase.from("users").insert({
    id,
    username: username.toLowerCase(),
    display_name: displayName,
    password_hash: passwordHash,
    role,
    created_at: createdAt,
    created_by: createdBy,
  });

  if (error) throw new Error(error.message);

  return { id, username: username.toLowerCase(), displayName, role, createdAt, createdBy };
}

export async function verifyPassword(username: string, password: string): Promise<User | null> {
  const user = await getUserByUsername(username);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}

export async function deleteUser(id: string): Promise<boolean> {
  // Clean up Storage files before deleting DB rows
  const { data: companies } = await supabase
    .from("companies")
    .select("id")
    .eq("user_id", id);

  if (companies?.length) {
    for (const company of companies) {
      const { data: files } = await supabase.storage
        .from("content-images")
        .list(`${id}/${company.id}`);
      if (files?.length) {
        const paths = files.map((f) => `${id}/${company.id}/${f.name}`);
        await supabase.storage.from("content-images").remove(paths);
      }
    }
  }

  // Delete companies (cascades to memory_files, saved_content, custom_tones, images)
  await supabase.from("companies").delete().eq("user_id", id);

  // Delete drive tokens (separate table, no cascade)
  await supabase.from("drive_tokens").delete().eq("user_id", id);

  // Delete the user
  const { error } = await supabase.from("users").delete().eq("id", id);
  return !error;
}

export async function changePassword(id: string, newPassword: string): Promise<boolean> {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const { error } = await supabase
    .from("users")
    .update({ password_hash: passwordHash })
    .eq("id", id);
  return !error;
}

export async function hasAnyUsers(): Promise<boolean> {
  const { count, error } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true });
  if (error) return false;
  return (count ?? 0) > 0;
}

export async function migrateExistingData(userId: string): Promise<number> {
  return 0;
}
