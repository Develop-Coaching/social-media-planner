import { supabase } from "@/lib/supabase";

export interface Company {
  id: string;
  name: string;
  logo?: string;
  brandColors?: string[];
  character?: string;
}

export interface CompaniesData {
  companies: Company[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCompany(row: any): Company {
  const company: Company = { id: row.id, name: row.name };
  if (row.logo) company.logo = row.logo;
  if (row.brand_colors?.length) company.brandColors = row.brand_colors;
  if (row.character) company.character = row.character;
  return company;
}

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || `company-${Date.now()}`;
}

export async function getCompanies(userId: string): Promise<Company[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("user_id", userId);
  if (error || !data) return [];
  return data.map(rowToCompany);
}

export async function addCompany(userId: string, name: string): Promise<Company> {
  const companies = await getCompanies(userId);
  const id = generateId(name);

  if (companies.some((c) => c.id === id)) {
    throw new Error(`Company with ID "${id}" already exists`);
  }

  const { error } = await supabase.from("companies").insert({
    user_id: userId,
    id,
    name,
  });

  if (error) throw new Error(error.message);

  return { id, name };
}

export async function updateCompany(userId: string, id: string, updates: Partial<Pick<Company, "name" | "logo" | "brandColors" | "character">>): Promise<Company | null> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.logo !== undefined) dbUpdates.logo = updates.logo;
  if (updates.brandColors !== undefined) dbUpdates.brand_colors = updates.brandColors;
  if (updates.character !== undefined) dbUpdates.character = updates.character;

  const { data, error } = await supabase
    .from("companies")
    .update(dbUpdates)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) return null;
  return rowToCompany(data);
}

export async function deleteCompany(userId: string, id: string): Promise<boolean> {
  // Clean up Storage files before DB delete (cascade only handles table rows)
  const { data: files } = await supabase.storage
    .from("content-images")
    .list(`${userId}/${id}`);
  if (files?.length) {
    const paths = files.map((f) => `${userId}/${id}/${f.name}`);
    await supabase.storage.from("content-images").remove(paths);
  }

  const { error } = await supabase
    .from("companies")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);

  return !error;
}
