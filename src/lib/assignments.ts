import { supabase } from "@/lib/supabase";

export interface Assignment {
  id: string;
  companyOwnerId: string;
  companyId: string;
  agentUserId: string;
  assignedBy: string;
  assignedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAssignment(row: any): Assignment {
  return {
    id: row.id,
    companyOwnerId: row.company_owner_id,
    companyId: row.company_id,
    agentUserId: row.agent_user_id,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
  };
}

export async function getAssignmentsForAgent(agentUserId: string): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from("company_assignments")
    .select("*")
    .eq("agent_user_id", agentUserId);
  if (error || !data) return [];
  return data.map(rowToAssignment);
}

export async function getAssignmentsForCompany(
  ownerId: string,
  companyId: string
): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from("company_assignments")
    .select("*")
    .eq("company_owner_id", ownerId)
    .eq("company_id", companyId);
  if (error || !data) return [];
  return data.map(rowToAssignment);
}

export async function createAssignment(
  companyOwnerId: string,
  companyId: string,
  agentUserId: string,
  assignedBy: string
): Promise<Assignment> {
  const { data, error } = await supabase
    .from("company_assignments")
    .insert({
      company_owner_id: companyOwnerId,
      company_id: companyId,
      agent_user_id: agentUserId,
      assigned_by: assignedBy,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Failed to create assignment");
  return rowToAssignment(data);
}

export async function removeAssignment(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("company_assignments")
    .delete()
    .eq("id", id);
  return !error;
}

export async function getAgentUsers(): Promise<{ id: string; username: string; displayName: string }[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id, username, display_name")
    .eq("role", "agent");
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
  }));
}
