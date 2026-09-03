import assert from "node:assert/strict";
import test from "node:test";
import { executeOwnershipTransfer, expectedTransferConfirmation } from "../scripts/migration/cutover-cli-common.mjs";

const ownershipChain = (result) => ({ select: () => ownershipChain(result), eq: () => ownershipChain(result), single: async () => result });
function fakeClient(overrides = {}) {
  const calls = [];
  return { calls, rpc: async (name, params) => {
    calls.push({ name, params });
    if (name === "publisher_cutover_readiness") return overrides.ready ?? { data: { ready: true, export_binding_sha256: "b" }, error: null };
    return overrides.transfer ?? { data: 8, error: null };
  }, from: () => ownershipChain(overrides.ownership ?? { data: { owner: "replacement", epoch: 8 }, error: null }) };
}

test("confirmation binds host, epoch, safety and export", () => {
  assert.equal(expectedTransferConfirmation({ projectHost: "p.supabase.co", expectedEpoch: 7, safetySeconds: 1800, exportSha256: "abc" }), "TRANSFER:p.supabase.co:7:1800:abc");
});

test("transfer runs readiness first with the same exact contract", async () => {
  const client = fakeClient();
  const result = await executeOwnershipTransfer({ supabase: client, rows: [{ id: 1 }], expectedEpoch: 7, safetySeconds: 1800 });
  assert.equal(result.replacementEpoch, 8);
  assert.deepEqual(client.calls.map((call) => call.name), ["publisher_cutover_readiness", "transfer_publisher_queue_ownership"]);
  assert.deepEqual(client.calls[0].params, client.calls[1].params);
});

for (const [name, overrides, pattern] of [
  ["readiness error", { ready: { data: null, error: { message: "network" } } }, /readiness failed closed/],
  ["not ready", { ready: { data: { ready: false }, error: null } }, /not ready/],
  ["transfer error", { transfer: { data: null, error: { message: "refused" } } }, /transfer failed/],
  ["wrong epoch", { transfer: { data: 9, error: null } }, /unexpected epoch/],
  ["ownership read error", { ownership: { data: null, error: { message: "read failed" } } }, /ownership proof failed/],
  ["ownership mismatch", { ownership: { data: { owner: "legacy", epoch: 7 }, error: null } }, /ownership proof failed/],
]) test(name, async () => assert.rejects(() => executeOwnershipTransfer({ supabase: fakeClient(overrides), rows: [], expectedEpoch: 7, safetySeconds: 1800 }), pattern));
