import { requestFingerprint } from "./fingerprint";
import { MAX_ATTEMPTS, nextRetryAt } from "./retry";
import type { AdapterRegistry, PublisherRepository, TickResult } from "./runtime-types";

// A single Instagram processing poll can consume most of a five-minute
// function window. Claim one delivery per invocation so a later item is never
// dispatch-marked immediately before the platform terminates the function.
const DEFAULT_LIMIT = 1;
const LEASE_SECONDS = 7 * 60;

export async function runPublisherTick(input: {
  expectedEpoch: number;
  dispatchEnabled: boolean;
  repository: PublisherRepository;
  adapters: AdapterRegistry;
  now?: Date;
  limit?: number;
}): Promise<TickResult> {
  if (!Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch < 1) {
    throw new Error("A positive publisher ownership epoch is required");
  }
  const now = input.now ?? new Date();
  const result: TickResult = {
    dispatchEnabled: input.dispatchEnabled,
    claimed: 0, succeeded: [], retryable: [], deadLetter: [], verificationRequired: [], reaped: [],
  };
  if (!input.dispatchEnabled) return result;
  result.reaped = await input.repository.reap(now);
  const deliveries = await input.repository.claim(input.expectedEpoch, input.limit ?? DEFAULT_LIMIT, LEASE_SECONDS, now);
  result.claimed = deliveries.length;

  // Preserve claim order in both provider dispatch and the returned outcome.
  // Database claims may run concurrently across workers; a single worker is
  // deliberately sequential so observable behavior is deterministic.
  for (const delivery of deliveries) {
    const id = delivery.delivery_id;
    if (delivery.content_type === "article") {
      if (await input.repository.deadLetter(id, delivery.lease_token, "Planning-only article reached publisher defence gate")) {
        result.deadLetter.push(id);
      }
      continue;
    }
    const fingerprint = requestFingerprint(delivery);
    const request = { delivery, requestFingerprint: fingerprint };
    const adapter = input.adapters[delivery.platform];
    let preflight = null;
    try {
      preflight = adapter.preflight ? await adapter.preflight(request) : null;
    } catch (error) {
      preflight = {
        kind: "safe_retry" as const,
        error: `Adapter preflight threw before dispatch: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (preflight) {
      if (preflight.kind === "permanent_failure" || delivery.attempt_number >= MAX_ATTEMPTS) {
        if (await input.repository.deadLetter(id, delivery.lease_token, preflight.error)) result.deadLetter.push(id);
      } else {
        const state = await input.repository.retry(id, delivery.lease_token, preflight.error, nextRetryAt(delivery.attempt_number, now));
        if (state === "dead_letter") result.deadLetter.push(id);
        else if (state === "retryable") result.retryable.push(id);
      }
      continue;
    }
    const marked = await input.repository.markDispatchStarted(id, delivery.lease_token, fingerprint);
    if (!marked) continue;

    let outcome;
    try {
      outcome = await adapter.publish(request);
    } catch (error) {
      outcome = { kind: "indeterminate" as const, error: `Adapter threw after dispatch began: ${error instanceof Error ? error.message : String(error)}` };
    }

    if (outcome.kind === "delivered") {
      if (!outcome.platformPostId.trim()) {
        if (await input.repository.verificationRequired(id, delivery.lease_token, "Provider reported success without a durable post ID")) {
          result.verificationRequired.push(id);
        }
      } else if (await input.repository.complete(id, delivery.lease_token, outcome)) {
        result.succeeded.push(id);
      }
    } else if (outcome.kind === "indeterminate") {
      if (await input.repository.verificationRequired(id, delivery.lease_token, outcome.error)) result.verificationRequired.push(id);
    } else if (outcome.kind === "permanent_failure" || delivery.attempt_number >= MAX_ATTEMPTS) {
      if (await input.repository.deadLetter(id, delivery.lease_token, outcome.error)) result.deadLetter.push(id);
    } else {
      // The schema only permits retry while pre-dispatch. Once an adapter has
      // been entered, a retry is safe only when it proves no public POST began.
      // Move the lease back to pre-dispatch is intentionally impossible, so
      // conservative deployments classify such outcomes as verification.
      if (await input.repository.verificationRequired(id, delivery.lease_token, `Safe retry requested after dispatch marker: ${outcome.error}`)) {
        result.verificationRequired.push(id);
      }
    }
  }
  return result;
}

export { nextRetryAt };
