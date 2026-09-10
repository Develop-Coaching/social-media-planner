// Synthetic local-only proof: seed supabase/fixtures/hermes_queue_demo.sql first.
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
const origin = "http://localhost:3117";
const secret = "synthetic-local-only-secret-at-least-32-bytes";
const user = "move-http-user", company = "move-http-company";
function headers(method, path, body, requestId) {
  const timestamp = String(Math.floor(Date.now()/1000));
  const url = new URL(path, origin);
  const query = new URLSearchParams([...url.searchParams.entries()].sort(([a,av],[b,bv])=>a<b?-1:a>b?1:av<bv?-1:av>bv?1:0)).toString();
  const canonical=[method,url.pathname+(query?`?${query}`:""),timestamp,requestId,user,company,createHash("sha256").update(body).digest("hex")].join("\n");
  return {"Content-Type":"application/json","X-Hermes-Key-Id":"synthetic-move-demo","X-Hermes-Timestamp":timestamp,"X-Hermes-Request-Id":requestId,"X-Hermes-Signature":createHmac("sha256",secret).update(canonical).digest("hex")};
}
async function call(method, path, payload, requestId=randomUUID()) {
  path="/api/hermes/v1/social-schedules"+path;
  const body=payload?JSON.stringify(payload):"";
  const response=await fetch(origin+path,{method,headers:headers(method,path,body,requestId),...(body?{body}:{})});
  return {status:response.status,body:await response.json()};
}
const preview=await call("GET","/queue?limit=2");assert.equal(preview.status,200);
assert.equal(preview.body.items.length,2);assert.ok(preview.body.nextCursor);
const next=await call("GET",`/queue?cursor=${preview.body.nextCursor}&limit=2`);assert.equal(next.body.items.length,1);
const items=[...preview.body.items,...next.body.items];assert.equal(items.length,3);assert.ok(items.every(i=>i.safeToReschedule));
const changes=items.map((item)=>({contentItemId:item.contentItemId,expectedScheduledAt:item.scheduledAt,expectedContentSha256:item.contentFingerprintSha256,scheduledAt:new Date(Date.parse(item.scheduledAt)+14*86400000).toISOString()}));
const payload={expectedEpoch:preview.body.ownershipEpoch,approvalReference:"synthetic-local-proof",changes};
const requestId=randomUUID();const moved=await call("POST","/reschedule",payload,requestId);assert.equal(moved.status,200);assert.equal(moved.body.replayed,false);assert.equal(moved.body.changes.length,3);
const replay=await call("POST","/reschedule",payload,requestId);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
const conflict=await call("POST","/reschedule",{...payload,approvalReference:"changed-proof"},requestId);assert.equal(conflict.status,409);
const stale=await call("POST","/reschedule",payload);assert.equal(stale.status,409);
const absent=await call("GET","/resolve?contentItemId=20000000-0000-4000-8000-000000000004");assert.equal(absent.status,404);
const legacy=await call("GET","/resolve?legacySppId=10000000-0000-4000-8000-000000000001");assert.equal(legacy.status,200);assert.equal(legacy.body.contentItemId,items[0].contentItemId);
const verified=await call("GET","/queue");assert.equal(verified.status,200);assert.deepEqual(verified.body.items.map(i=>Date.parse(i.scheduledAt)),changes.map(i=>Date.parse(i.scheduledAt)));
const browserPath="/api/hermes/v1/social-schedules/queue";
await writeFile("/tmp/publisher-reschedule-browser-headers.json",JSON.stringify(headers("GET",browserPath,"",randomUUID())));
await writeFile("/tmp/publisher-reschedule-http-proof.json",JSON.stringify({preview:items.map(i=>({id:i.contentItemId,at:i.scheduledAt})),moved:moved.body,replay:replay.status,conflict:conflict.status,stale:stale.status,crossTenant:absent.status,verified:verified.body},null,2));
console.log("PASS: signed mixed queue pagination, three atomic date moves, exact replay, request conflict, stale preview, legacy resolution, cross-tenant 404 and post-move verification.");
