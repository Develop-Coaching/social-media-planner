import { promises as fs } from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { sanitizeId, validatePath } from "@/lib/sanitize";

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: "admin" | "user";
  createdAt: string;
  createdBy: string | null;
}

interface UsersData {
  users: User[];
}

async function ensureDataDir(dir?: string) {
  try {
    await fs.mkdir(dir || DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

async function readUsers(): Promise<User[]> {
  try {
    await ensureDataDir();
    const raw = await fs.readFile(USERS_FILE, "utf-8");
    const data = JSON.parse(raw) as UsersData;
    return data.users;
  } catch {
    return [];
  }
}

async function writeUsers(users: User[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2), "utf-8");
}

export async function getUsers(): Promise<Omit<User, "passwordHash">[]> {
  const users = await readUsers();
  return users.map(({ passwordHash: _, ...rest }) => rest);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const users = await readUsers();
  return users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
}

export async function getUserById(id: string): Promise<User | null> {
  const users = await readUsers();
  return users.find((u) => u.id === id) || null;
}

export async function createUser(
  username: string,
  displayName: string,
  password: string,
  role: "admin" | "user",
  createdBy: string | null
): Promise<Omit<User, "passwordHash">> {
  const users = await readUsers();

  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("Username already exists");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user: User = {
    id: crypto.randomUUID(),
    username: username.toLowerCase(),
    displayName,
    passwordHash,
    role,
    createdAt: new Date().toISOString(),
    createdBy,
  };

  users.push(user);
  await writeUsers(users);

  const { passwordHash: _, ...safe } = user;
  return safe;
}

export async function verifyPassword(username: string, password: string): Promise<User | null> {
  const user = await getUserByUsername(username);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}

export async function deleteUser(id: string): Promise<boolean> {
  const users = await readUsers();
  const index = users.findIndex((u) => u.id === id);
  if (index === -1) return false;
  users.splice(index, 1);
  await writeUsers(users);

  // Clean up user's data directory
  const safeId = sanitizeId(id);
  if (safeId) {
    const userDir = path.join(DATA_DIR, safeId);
    validatePath(userDir, DATA_DIR);
    try {
      await fs.rm(userDir, { recursive: true, force: true });
    } catch {
      // Directory may not exist, that's fine
    }
  }

  return true;
}

export async function changePassword(id: string, newPassword: string): Promise<boolean> {
  const users = await readUsers();
  const user = users.find((u) => u.id === id);
  if (!user) return false;
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await writeUsers(users);
  return true;
}

export async function hasAnyUsers(): Promise<boolean> {
  const users = await readUsers();
  return users.length > 0;
}

/**
 * Migrate existing flat data files into a user's directory.
 * Copies companies.json, memory-*.json, saved-content-*.json, custom-tones-*.json
 * from data/ into data/{userId}/.
 */
export async function migrateExistingData(userId: string): Promise<number> {
  const userDir = path.join(DATA_DIR, userId);
  await ensureDataDir(userDir);

  const patterns = ["companies.json", "memory-", "saved-content-", "custom-tones-"];
  let migrated = 0;

  try {
    const files = await fs.readdir(DATA_DIR);
    for (const file of files) {
      const isDataFile = patterns.some((p) =>
        p.endsWith(".json") ? file === p : file.startsWith(p) && file.endsWith(".json")
      );
      if (!isDataFile) continue;

      const src = path.join(DATA_DIR, file);
      const dest = path.join(userDir, file);

      // Only copy regular files, skip directories
      const stat = await fs.stat(src);
      if (!stat.isFile()) continue;

      // Don't overwrite if destination already exists
      try {
        await fs.access(dest);
        continue; // already exists
      } catch {
        // doesn't exist, safe to copy
      }

      await fs.copyFile(src, dest);
      migrated++;
    }
  } catch {
    // data dir may not exist yet
  }

  return migrated;
}
