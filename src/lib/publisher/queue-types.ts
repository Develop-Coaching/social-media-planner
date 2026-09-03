export type PublisherOwner = "legacy" | "replacement";

export type PublisherDeliveryState =
  | "migration_frozen"
  | "planning_only"
  | "pending"
  | "leased"
  | "retryable"
  | "verification_required"
  | "succeeded"
  | "dead_letter"
  | "cancelled"
  | "historical";

export interface PublisherOwnership {
  source: "legacy_spp";
  owner: PublisherOwner;
  epoch: number;
  cutoff_at: string | null;
  reconciliation_sha256: string | null;
}

export interface ClaimedPublisherDelivery {
  delivery_id: string;
  content_item_id: string;
  platform: "instagram" | "facebook" | "linkedin";
  idempotency_key: string;
  attempt_number: number;
  lease_token: string;
  lease_expires_at: string;
  user_id: string;
  company_id: string;
  content_type: string;
  caption: string;
  media: Record<string, unknown>;
  scheduled_at: string;
  legacy_spp_id: string | null;
}
