import { timingSafeEqual } from "node:crypto";

const KNOWN_WEAK = new Set([
  "password", "password123", "changeme", "change-me", "secret", "admin",
  "postpilot-default-secret-change-me", "development-secret", "test-secret",
]);

function characterClasses(value: string): number {
  return [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
}

export function isStrongAuthSecret(value: string | undefined): boolean {
  if (!value || new TextEncoder().encode(value).length < 32) return false;
  const normalized = value.trim().toLowerCase();
  if (KNOWN_WEAK.has(normalized) || normalized.includes("change-me")) return false;
  if (new Set(value).size < 12) return false;
  return !/^(.{1,16})\1+$/.test(value);
}

export function credentialPolicyError(value: string | undefined, label = "Password"): string | null {
  if (!value || value.length < 12) return `${label} must be at least 12 characters`;
  if (KNOWN_WEAK.has(value.trim().toLowerCase())) return `${label} is too common`;
  if (characterClasses(value) < 3) return `${label} must include at least three character types`;
  return null;
}

export function isStrongSetupKey(value: string | undefined): boolean {
  return !credentialPolicyError(value, "Setup key") && (value?.length ?? 0) >= 16;
}

export function secureCredentialEqual(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}
