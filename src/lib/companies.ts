import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

function getUserDir(userId: string): string {
  return path.join(DATA_DIR, userId);
}

function getCompaniesFile(userId: string): string {
  return path.join(getUserDir(userId), "companies.json");
}

export interface Company {
  id: string;
  name: string;
}

export interface CompaniesData {
  companies: Company[];
}

async function ensureUserDir(userId: string) {
  try {
    await fs.mkdir(getUserDir(userId), { recursive: true });
  } catch {
    // ignore
  }
}

export async function getCompanies(userId: string): Promise<Company[]> {
  try {
    await ensureUserDir(userId);
    const raw = await fs.readFile(getCompaniesFile(userId), "utf-8");
    const data = JSON.parse(raw) as CompaniesData;
    return data.companies;
  } catch {
    return [];
  }
}

async function saveCompanies(userId: string, companies: Company[]): Promise<void> {
  await ensureUserDir(userId);
  await fs.writeFile(
    getCompaniesFile(userId),
    JSON.stringify({ companies }, null, 2),
    "utf-8"
  );
}

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || `company-${Date.now()}`;
}

export async function addCompany(userId: string, name: string): Promise<Company> {
  const companies = await getCompanies(userId);
  const id = generateId(name);

  if (companies.some((c) => c.id === id)) {
    throw new Error(`Company with ID "${id}" already exists`);
  }

  const company: Company = { id, name };
  companies.push(company);
  await saveCompanies(userId, companies);
  return company;
}

export async function deleteCompany(userId: string, id: string): Promise<boolean> {
  const companies = await getCompanies(userId);
  const index = companies.findIndex((c) => c.id === id);
  if (index === -1) return false;
  companies.splice(index, 1);
  await saveCompanies(userId, companies);
  return true;
}
