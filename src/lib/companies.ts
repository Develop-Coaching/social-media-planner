import { supabase } from "@/lib/supabase";

export interface Company {
  id: string;
  name: string;
  logo?: string;
  brandColors?: string[];
  fontFamily?: string;
  slackWebhookUrl?: string;
  slackEditorWebhookUrl?: string;
  slackBotToken?: string;
  slackChannelId?: string;
}

export interface CompaniesData {
  companies: Company[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCompany(row: any): Company {
  const company: Company = { id: row.id, name: row.name };
  if (row.logo) company.logo = row.logo;
  if (row.brand_colors?.length) company.brandColors = row.brand_colors;
  if (row.slack_webhook_url) company.slackWebhookUrl = row.slack_webhook_url;
  if (row.slack_editor_webhook_url) company.slackEditorWebhookUrl = row.slack_editor_webhook_url;
  if (row.slack_bot_token) company.slackBotToken = row.slack_bot_token;
  if (row.slack_channel_id) company.slackChannelId = row.slack_channel_id;
  if (row.font_family) company.fontFamily = row.font_family;
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

export interface AddCompanyOptions {
  logo?: string;
  brandColors?: string[];
  fontFamily?: string;
  slackWebhookUrl?: string;
  slackEditorWebhookUrl?: string;
  slackBotToken?: string;
  slackChannelId?: string;
}

export async function addCompany(userId: string, name: string, options?: AddCompanyOptions): Promise<Company> {
  const companies = await getCompanies(userId);
  const id = generateId(name);

  if (companies.some((c) => c.id === id)) {
    throw new Error(`Company with ID "${id}" already exists`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { user_id: userId, id, name };
  if (options?.logo) row.logo = options.logo;
  if (options?.brandColors?.length) row.brand_colors = options.brandColors;
  if (options?.fontFamily) row.font_family = options.fontFamily;
  if (options?.slackWebhookUrl) row.slack_webhook_url = options.slackWebhookUrl;
  if (options?.slackEditorWebhookUrl) row.slack_editor_webhook_url = options.slackEditorWebhookUrl;
  if (options?.slackBotToken) row.slack_bot_token = options.slackBotToken;
  if (options?.slackChannelId) row.slack_channel_id = options.slackChannelId;

  const { data, error } = await supabase.from("companies").insert(row).select("*").single();

  if (error) throw new Error(error.message);

  return rowToCompany(data);
}

export async function updateCompany(userId: string, id: string, updates: Partial<Pick<Company, "name" | "logo" | "brandColors" | "fontFamily" | "slackWebhookUrl" | "slackEditorWebhookUrl" | "slackBotToken" | "slackChannelId">>): Promise<Company | null> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.logo !== undefined) dbUpdates.logo = updates.logo;
  if (updates.brandColors !== undefined) dbUpdates.brand_colors = updates.brandColors;
  if (updates.fontFamily !== undefined) dbUpdates.font_family = updates.fontFamily;
  if (updates.slackWebhookUrl !== undefined) dbUpdates.slack_webhook_url = updates.slackWebhookUrl;
  if (updates.slackEditorWebhookUrl !== undefined) dbUpdates.slack_editor_webhook_url = updates.slackEditorWebhookUrl;
  if (updates.slackBotToken !== undefined) dbUpdates.slack_bot_token = updates.slackBotToken;
  if (updates.slackChannelId !== undefined) dbUpdates.slack_channel_id = updates.slackChannelId;

  const { data, error } = await supabase
    .from("companies")
    .update(dbUpdates)
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return rowToCompany(data);
}

export async function getCompanyById(userId: string, companyId: string): Promise<Company | null> {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("user_id", userId)
    .eq("id", companyId)
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
  // Clean up character images subfolder
  const { data: charFiles } = await supabase.storage
    .from("content-images")
    .list(`${userId}/${id}/characters`);
  if (charFiles?.length) {
    const charPaths = charFiles.map((f) => `${userId}/${id}/characters/${f.name}`);
    await supabase.storage.from("content-images").remove(charPaths);
  }

  const { error } = await supabase
    .from("companies")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);

  return !error;
}
