import { NextRequest } from "next/server";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
}

const limiters = new Map<string, Map<string, RateLimitEntry>>();

export function createRateLimiter(name: string, options: RateLimiterOptions) {
  if (!limiters.has(name)) {
    limiters.set(name, new Map());
  }
  const store = limiters.get(name)!;

  return {
    check(ip: string): { allowed: boolean; retryAfterMs: number } {
      const now = Date.now();
      const entry = store.get(ip);

      if (!entry || now >= entry.resetAt) {
        store.set(ip, { count: 1, resetAt: now + options.windowMs });
        return { allowed: true, retryAfterMs: 0 };
      }

      if (entry.count >= options.maxAttempts) {
        return { allowed: false, retryAfterMs: entry.resetAt - now };
      }

      entry.count++;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

export function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}
