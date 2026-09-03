export function expectedTransferConfirmation({ projectHost, expectedEpoch, safetySeconds, exportSha256 }) {
  return `TRANSFER:${projectHost}:${expectedEpoch}:${safetySeconds}:${exportSha256}`;
}

export async function executeOwnershipTransfer({ supabase, rows, expectedEpoch, safetySeconds }) {
  const ready = await supabase.rpc("publisher_cutover_readiness", {
    p_rows: rows, p_expected_epoch: expectedEpoch, p_safety_seconds: safetySeconds,
  });
  if (ready.error || ready.data?.ready !== true) throw new Error(`Final readiness failed closed: ${ready.error?.message ?? "not ready"}`);
  const transfer = await supabase.rpc("transfer_publisher_queue_ownership", {
    p_rows: rows, p_expected_epoch: expectedEpoch, p_safety_seconds: safetySeconds,
  });
  if (transfer.error) throw new Error(`Atomic ownership transfer failed: ${transfer.error.message}`);
  if (transfer.data !== expectedEpoch + 1) throw new Error("Transfer returned an unexpected epoch");
  const ownershipResult = await supabase.from("publisher_queue_ownership")
    .select("owner,epoch,cutoff_at,reconciliation_sha256").eq("source", "legacy_spp").single();
  if (ownershipResult.error || ownershipResult.data?.owner !== "replacement" || ownershipResult.data?.epoch !== transfer.data) {
    throw new Error(`Post-transfer ownership proof failed: ${ownershipResult.error?.message ?? "unexpected owner/epoch"}`);
  }
  return { readiness: ready.data, ownership: ownershipResult.data, replacementEpoch: transfer.data };
}
