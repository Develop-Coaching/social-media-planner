import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const COMPANIES_FILE = path.join(DATA_DIR, "companies.json");

export interface Company {
  id: string;
  name: string;
}

export interface CompaniesData {
  companies: Company[];
}

const defaultCompanies: CompaniesData = {
  companies: [
    { id: "peak-span", name: "Peak Span" },
    { id: "develop", name: "Develop" },
  ],
};

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

export async function getCompanies(): Promise<Company[]> {
  try {
    await ensureDataDir();
    const raw = await fs.readFile(COMPANIES_FILE, "utf-8");
    const data = JSON.parse(raw) as CompaniesData;
    return data.companies;
  } catch {
    // File doesn't exist, create with defaults
    await saveCompanies(defaultCompanies.companies);
    return defaultCompanies.companies;
  }
}

async function saveCompanies(companies: Company[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(
    COMPANIES_FILE,
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

export async function addCompany(name: string): Promise<Company> {
  const companies = await getCompanies();
  const id = generateId(name);

  // Check for duplicate ID
  if (companies.some((c) => c.id === id)) {
    throw new Error(`Company with ID "${id}" already exists`);
  }

  const company: Company = { id, name };
  companies.push(company);
  await saveCompanies(companies);
  return company;
}

export async function deleteCompany(id: string): Promise<boolean> {
  const companies = await getCompanies();
  const index = companies.findIndex((c) => c.id === id);
  if (index === -1) return false;
  companies.splice(index, 1);
  await saveCompanies(companies);
  return true;
}
