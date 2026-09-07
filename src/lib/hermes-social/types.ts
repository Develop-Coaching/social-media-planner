export interface HermesPlatformOutcome {
  platform: "instagram" | "facebook" | "linkedin";
  state: string;
  attemptCount: number;
  platformPostId: string | null;
  liveUrl: string | null;
  publishedAt: string | null;
  hasError: boolean;
}
export interface HermesScheduleResult {
  scheduleId: string;
  companyId: string;
  legacySppId: string;
  source: "legacy_spp";
  ownershipEpoch: number;
  state: "active" | "cancelled";
  scheduledAt: string;
  approvalReference: string;
  contentFingerprintSha256: string;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  platforms: HermesPlatformOutcome[];
  replayed?: boolean;
}
