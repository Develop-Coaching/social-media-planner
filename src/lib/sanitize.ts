import path from "path";

/**
 * Sanitize an ID (userId or companyId) to only allow safe characters.
 * Strips everything except alphanumeric, hyphens, and underscores.
 */
export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Validate that a resolved file path is within the expected base directory.
 * Throws if the path escapes the base directory (path traversal defense).
 */
export function validatePath(filePath: string, baseDir: string): string {
  const resolved = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error("Invalid path: directory traversal detected");
  }
  return resolved;
}
