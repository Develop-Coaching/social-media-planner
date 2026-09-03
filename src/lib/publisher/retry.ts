export const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 5 * 60 * 1000;

export function nextRetryAt(attemptNumber: number, now: Date): Date {
  const exponent = Math.max(0, attemptNumber - 1);
  return new Date(now.getTime() + BASE_DELAY_MS * 2 ** exponent);
}
