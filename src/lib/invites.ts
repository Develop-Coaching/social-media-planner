import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/lib/auth";

export interface Invite {
  id: string;
  token: string;
  email: string | null;
  role: UserRole;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToInvite(row: any): Invite {
  return {
    id: row.id,
    token: row.token,
    email: row.email,
    role: row.role,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedBy: row.used_by,
  };
}

export async function createInvite(
  email: string | null,
  role: UserRole,
  createdBy: string
): Promise<Invite> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("invites")
    .insert({
      token,
      email: email || null,
      role,
      created_by: createdBy,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Failed to create invite");
  return rowToInvite(data);
}

export async function getInvites(): Promise<Invite[]> {
  const { data, error } = await supabase
    .from("invites")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data.map(rowToInvite);
}

export async function getInviteByToken(token: string): Promise<Invite | null> {
  const { data, error } = await supabase
    .from("invites")
    .select("*")
    .eq("token", token)
    .single();

  if (error || !data) return null;
  return rowToInvite(data);
}

export async function markInviteUsed(token: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("invites")
    .update({ used_at: new Date().toISOString(), used_by: userId })
    .eq("token", token);

  if (error) throw new Error(error.message);
}

export async function revokeInvite(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("invites")
    .delete()
    .eq("id", id);

  return !error;
}

export function isInviteValid(invite: Invite): boolean {
  if (invite.usedAt) return false;
  if (new Date(invite.expiresAt) < new Date()) return false;
  return true;
}
