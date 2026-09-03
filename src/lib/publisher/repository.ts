import { supabase } from "@/lib/supabase";
import type { ClaimedPublisherDelivery } from "./queue-types";
import type { AdapterOutcome, ProviderCheckpoint, PublisherRepository } from "./runtime-types";

function fail(operation: string, error: { message: string } | null): never {
  throw new Error(`${operation}: ${error?.message ?? "compare-and-set failed"}`);
}

export function createPublisherRepository(): PublisherRepository {
  return {
    async reap(now) {
      const { data, error } = await supabase.rpc("reap_expired_publisher_leases", { p_now: now.toISOString() });
      if (error) fail("reap_expired_publisher_leases", error);
      return (data ?? []) as Array<{ delivery_id: string; new_state: string }>;
    },
    async claim(expectedEpoch, limit, leaseSeconds, now) {
      const { data, error } = await supabase.rpc("claim_publisher_deliveries", {
        p_expected_epoch: expectedEpoch,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
        p_now: now.toISOString(),
      });
      if (error) fail("claim_publisher_deliveries", error);
      return (data ?? []) as ClaimedPublisherDelivery[];
    },
    async markDispatchStarted(deliveryId, leaseToken, fingerprint) {
      const { data, error } = await supabase.rpc("mark_publisher_dispatch_started", {
        p_delivery_id: deliveryId,
        p_lease_token: leaseToken,
        p_request_fingerprint_sha256: fingerprint,
      });
      if (error) fail("mark_publisher_dispatch_started", error);
      return data === true;
    },
    async checkpoint(deliveryId, leaseToken, checkpoint: ProviderCheckpoint) {
      const { data, error } = await supabase.rpc("checkpoint_publisher_delivery", {
        p_delivery_id: deliveryId,
        p_lease_token: leaseToken,
        p_provider_reconciliation_metadata: checkpoint,
      });
      if (error) fail("checkpoint_publisher_delivery", error);
      return data === true;
    },
    async complete(deliveryId, leaseToken, outcome: Extract<AdapterOutcome, { kind: "delivered" }>) {
      const { data, error } = await supabase.rpc("complete_publisher_delivery", {
        p_delivery_id: deliveryId,
        p_lease_token: leaseToken,
        p_platform_post_id: outcome.platformPostId,
        p_live_url: outcome.liveUrl ?? null,
        p_provider_response: outcome.providerResponse ?? null,
      });
      if (error) fail("complete_publisher_delivery", error);
      return data === true;
    },
    async retry(deliveryId, leaseToken, errorText, nextAttemptAt) {
      const { data, error } = await supabase.rpc("retry_publisher_delivery", {
        p_delivery_id: deliveryId,
        p_lease_token: leaseToken,
        p_error: errorText,
        p_next_attempt_at: nextAttemptAt.toISOString(),
      });
      if (error) fail("retry_publisher_delivery", error);
      return data as string | null;
    },
    async deadLetter(deliveryId, leaseToken, errorText) {
      const { data, error } = await supabase.rpc("dead_letter_publisher_delivery", {
        p_delivery_id: deliveryId, p_lease_token: leaseToken, p_error: errorText,
      });
      if (error) fail("dead_letter_publisher_delivery", error);
      return data === true;
    },
    async verificationRequired(deliveryId, leaseToken, errorText) {
      const { data, error } = await supabase.rpc("mark_publisher_verification_required", {
        p_delivery_id: deliveryId, p_lease_token: leaseToken, p_error: errorText,
      });
      if (error) fail("mark_publisher_verification_required", error);
      return data === true;
    },
  };
}
