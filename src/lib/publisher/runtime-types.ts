import type { ClaimedPublisherDelivery } from "./queue-types";

export interface PublishRequest {
  delivery: ClaimedPublisherDelivery;
  requestFingerprint: string;
}

export type AdapterOutcome =
  | { kind: "delivered"; platformPostId: string; liveUrl?: string; providerResponse?: Record<string, unknown> }
  | { kind: "safe_retry"; error: string }
  | { kind: "permanent_failure"; error: string }
  | { kind: "indeterminate"; error: string };

export interface PublisherAdapter {
  preflight?(request: PublishRequest): Promise<Extract<AdapterOutcome, { kind: "safe_retry" | "permanent_failure" }> | null>;
  publish(request: PublishRequest): Promise<AdapterOutcome>;
}

export type AdapterRegistry = Record<ClaimedPublisherDelivery["platform"], PublisherAdapter>;

export interface PublisherRepository {
  reap(now: Date): Promise<Array<{ delivery_id: string; new_state: string }>>;
  claim(expectedEpoch: number, limit: number, leaseSeconds: number, now: Date): Promise<ClaimedPublisherDelivery[]>;
  markDispatchStarted(deliveryId: string, leaseToken: string, fingerprint: string): Promise<boolean>;
  complete(deliveryId: string, leaseToken: string, outcome: Extract<AdapterOutcome, { kind: "delivered" }>): Promise<boolean>;
  retry(deliveryId: string, leaseToken: string, error: string, nextAttemptAt: Date): Promise<string | null>;
  deadLetter(deliveryId: string, leaseToken: string, error: string): Promise<boolean>;
  verificationRequired(deliveryId: string, leaseToken: string, error: string): Promise<boolean>;
}

export interface TickResult {
  dispatchEnabled: boolean;
  claimed: number;
  succeeded: string[];
  retryable: string[];
  deadLetter: string[];
  verificationRequired: string[];
  reaped: Array<{ delivery_id: string; new_state: string }>;
}
