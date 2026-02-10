import { promises as fs } from "fs";
import path from "path";
import { google } from "googleapis";
import { sanitizeId, validatePath } from "@/lib/sanitize";

const DATA_DIR = path.join(process.cwd(), "data");

export interface DriveTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  email: string;
}

function getUserDir(userId: string): string {
  if (userId === "default") return DATA_DIR;
  const dir = path.join(DATA_DIR, sanitizeId(userId));
  validatePath(dir, DATA_DIR);
  return dir;
}

function getTokensFile(userId: string): string {
  const filePath = path.join(getUserDir(userId), "drive-tokens.json");
  validatePath(filePath, DATA_DIR);
  return filePath;
}

async function ensureUserDir(userId: string) {
  try {
    await fs.mkdir(getUserDir(userId), { recursive: true });
  } catch {
    // ignore
  }
}

export async function getDriveTokens(userId: string): Promise<DriveTokens | null> {
  try {
    const raw = await fs.readFile(getTokensFile(userId), "utf-8");
    return JSON.parse(raw) as DriveTokens;
  } catch {
    return null;
  }
}

export async function saveDriveTokens(userId: string, tokens: DriveTokens): Promise<void> {
  await ensureUserDir(userId);
  await fs.writeFile(getTokensFile(userId), JSON.stringify(tokens, null, 2), "utf-8");
}

export async function clearDriveTokens(userId: string): Promise<void> {
  try {
    await fs.unlink(getTokensFile(userId));
  } catch {
    // ignore if doesn't exist
  }
}

export async function refreshAccessToken(userId: string): Promise<DriveTokens | null> {
  const tokens = await getDriveTokens(userId);
  if (!tokens?.refreshToken) return null;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: tokens.refreshToken });

  try {
    const { credentials } = await oauth2.refreshAccessToken();
    const updated: DriveTokens = {
      ...tokens,
      accessToken: credentials.access_token!,
      expiresAt: credentials.expiry_date || Date.now() + 3600 * 1000,
    };
    await saveDriveTokens(userId, updated);
    return updated;
  } catch {
    return null;
  }
}
