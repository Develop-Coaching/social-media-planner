// Pure decision logic for what happens to a scheduled post after one tick.
// Kept side-effect free so it can be exercised without Supabase or tokens.

// Keys stashed inside platform_post_ids (jsonb) alongside the real platform
// ids. They track an IG reel container that is still processing on Meta's
// side, so the next tick resumes it instead of re-uploading from zero.
export const IG_CONTAINER_KEY = "instagram_container";
export const IG_CONTAINER_SINCE_KEY = "instagram_container_since";

// Total time we let one container process across ticks before giving up.
// IG processing is highly variable (observed 33s to >4min for the same
// file); anything past this is a genuinely stuck container.
export const IG_WAIT_CAP_MS = 20 * 60 * 1000;

export interface TickOutcomeInput {
  errors: string[]; // real per-platform failures this tick
  waitingOnContainer: boolean; // IG reel container still IN_PROGRESS
  containerSinceMs: number | null; // when the container was first stored
  nowMs: number;
  retryCount: number; // retries consumed before this tick
  maxRetries: number;
}

export interface TickOutcome {
  kind: "published" | "waiting" | "retrying" | "failed";
  status: "published" | "queued" | "failed";
  retryCount: number;
  error: string | null;
}

export function decideTickOutcome(input: TickOutcomeInput): TickOutcome {
  const { errors, waitingOnContainer, containerSinceMs, nowMs, maxRetries } = input;

  const waitedMs = waitingOnContainer && containerSinceMs !== null ? nowMs - containerSinceMs : 0;
  const containerTimedOut = waitingOnContainer && waitedMs > IG_WAIT_CAP_MS;

  if (errors.length === 0 && !waitingOnContainer) {
    return { kind: "published", status: "published", retryCount: input.retryCount, error: null };
  }

  if (containerTimedOut) {
    const detail = `instagram: reel container still processing after ${Math.round(waitedMs / 60000)} min, giving up`;
    return {
      kind: "failed",
      status: "failed",
      retryCount: input.retryCount,
      error: [detail, ...errors].join(" | "),
    };
  }

  if (errors.length === 0) {
    // Only waiting on IG processing — not a failed attempt, so retry_count is
    // untouched and the row goes back to queued for the next tick to resume.
    return {
      kind: "waiting",
      status: "queued",
      retryCount: input.retryCount,
      error: `instagram: reel still processing (${Math.round(waitedMs / 1000)}s so far), resuming next tick`,
    };
  }

  // Real failures (possibly alongside a pending container, which stays stored
  // so IG can still resume on the retry tick).
  const retryCount = input.retryCount + 1;
  return {
    kind: retryCount >= maxRetries ? "failed" : "retrying",
    status: retryCount >= maxRetries ? "failed" : "queued",
    retryCount,
    error: errors.join(" | "),
  };
}
