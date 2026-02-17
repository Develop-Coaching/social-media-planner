import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/lib/auth";

export interface CompanyAccessResult {
  effectiveUserId: string;
  isAssigned: boolean;
}

/**
 * Resolves the effective userId for a company access request.
 * - If the user owns the company, returns their own userId.
 * - If the user is assigned (agent) to the company, returns the company owner's userId.
 * - Otherwise throws a 404 error.
 */
export async function resolveCompanyAccess(
  userId: string,
  role: UserRole,
  companyId: string
): Promise<CompanyAccessResult> {
  // Check if user owns the company
  const { data: owned } = await supabase
    .from("companies")
    .select("id")
    .eq("user_id", userId)
    .eq("id", companyId)
    .single();

  if (owned) {
    return { effectiveUserId: userId, isAssigned: false };
  }

  // For agents and admins, check assignments
  if (role === "agent" || role === "admin") {
    const { data: assignment } = await supabase
      .from("company_assignments")
      .select("company_owner_id")
      .eq("company_id", companyId)
      .eq("agent_user_id", userId)
      .single();

    if (assignment) {
      return { effectiveUserId: assignment.company_owner_id, isAssigned: true };
    }
  }

  throw new CompanyAccessError("Company not found", 404);
}

export class CompanyAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
