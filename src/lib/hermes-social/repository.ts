import { supabase } from "@/lib/supabase";
import type { HermesScheduleResult } from "./types";

export class HermesRepositoryError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

function mapError(error: { code?: string; message: string } | null): never {
  const code = error?.code;
  const status = code === "23505" || code === "40001" || code === "55000"
    ? 409 : code === "P0002" ? 404 : code === "22023" ? 400 : code === "42501" ? 403 : 503;
  throw new HermesRepositoryError(
    status === 503 ? "Hermes schedule service is unavailable" : (error?.message ?? "Hermes request failed"),
    status,
  );
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) mapError(error);
  return data as T;
}

export function previewLegacySchedule(identity: RequestIdentity, legacySppId: string) {
  return rpc<Record<string, unknown> | null>("hermes_preview_legacy_social_schedule", {
    p_user_id: identity.userId, p_company_id: identity.companyId, p_legacy_spp_id: legacySppId,
  });
}

export function getHermesSchedule(identity: RequestIdentity, scheduleId: string) {
  return rpc<HermesScheduleResult | null>("hermes_get_social_schedule", {
    p_user_id: identity.userId, p_company_id: identity.companyId, p_schedule_id: scheduleId,
  });
}

interface RequestIdentity {
  requestId: string; requestFingerprintSha256: string; actor: string;
  userId: string; companyId: string;
}

export function adoptHermesSchedule(identity: RequestIdentity, input: {
  expectedEpoch: number; legacySppId: string; scheduledAt: string;
  approvalReference: string; expectedContentSha256: string;
}) {
  return rpc<HermesScheduleResult>("hermes_adopt_social_schedule", {
    p_request_id: identity.requestId,
    p_request_fingerprint_sha256: identity.requestFingerprintSha256,
    p_expected_epoch: input.expectedEpoch,
    p_user_id: identity.userId,
    p_company_id: identity.companyId,
    p_legacy_spp_id: input.legacySppId,
    p_scheduled_at: input.scheduledAt,
    p_approval_reference: input.approvalReference,
    p_expected_content_sha256: input.expectedContentSha256,
    p_actor: identity.actor,
  });
}

export function cancelHermesSchedule(identity: RequestIdentity, scheduleId: string, input: {
  expectedEpoch: number; reason: string;
}) {
  return rpc<HermesScheduleResult>("hermes_cancel_social_schedule", {
    p_request_id: identity.requestId,
    p_request_fingerprint_sha256: identity.requestFingerprintSha256,
    p_schedule_id: scheduleId,
    p_expected_epoch: input.expectedEpoch,
    p_user_id: identity.userId,
    p_company_id: identity.companyId,
    p_reason: input.reason,
    p_actor: identity.actor,
  });
}

export function restoreHermesSchedule(identity: RequestIdentity, scheduleId: string, input: {
  expectedEpoch: number; scheduledAt: string;
}) {
  return rpc<HermesScheduleResult>("hermes_restore_social_schedule", {
    p_request_id: identity.requestId,
    p_request_fingerprint_sha256: identity.requestFingerprintSha256,
    p_schedule_id: scheduleId,
    p_expected_epoch: input.expectedEpoch,
    p_user_id: identity.userId,
    p_company_id: identity.companyId,
    p_scheduled_at: input.scheduledAt,
    p_actor: identity.actor,
  });
}
