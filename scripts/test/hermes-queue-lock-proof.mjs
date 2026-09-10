// Local Docker only. Proves worker/reschedule serialization with two real sessions.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
const container = "supabase_db_social-media-planner";
const args = ["exec","-i",container,"psql","-U","postgres","-v","ON_ERROR_STOP=1","-At"];
function sql(query) { return execFileSync("docker",args,{input:query,encoding:"utf8"}); }
function session(query, marker) {
  const child=spawn("docker",args);let output="",errors="",readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  child.stdout.on("data",chunk=>{output+=chunk;if(marker&&output.includes(marker))readyResolve();});
  child.stderr.on("data",chunk=>{errors+=chunk;});child.stdin.end(query);
  const done=new Promise((resolve,reject)=>{child.on("exit",code=>code===0?resolve(output):reject(new Error(errors)));child.on("error",reject);});
  return {ready,done};
}
const id="90000000-0000-4000-8000-000000000001";
sql(`insert into public.companies(user_id,id,name) values('lock-demo','lock-demo','Synthetic lock proof');
insert into public.publisher_content_items(id,user_id,company_id,content_type,caption,scheduled_at,approval_state,migration_state)
values('${id}','lock-demo','lock-demo','post','Synthetic lock proof',now()-interval '1 hour','approved','native');
insert into public.publisher_deliveries(content_item_id,platform,state,idempotency_key,next_attempt_at)
values('${id}','facebook','pending','lock-demo:facebook',now()-interval '1 hour');`);
function moveCall(requestId) { return `select public.hermes_reschedule_social_queue('${requestId}',repeat('a',64),2,'lock-demo','lock-demo',
(select jsonb_build_array(jsonb_build_object('contentItemId',id,'expectedScheduledAt',scheduled_at,'expectedContentSha256',publisher_private.hermes_queue_fingerprint(id),'scheduledAt',now()+interval '2 days')) from public.publisher_content_items where id='${id}'),'approval:lock-demo','hermes:demo');`; }
const moving=session(`begin;select owner from public.publisher_queue_ownership where source='legacy_spp' for update;
\\echo MOVE_LOCK_HELD
select pg_sleep(2);${moveCall("90000000-0000-4000-8000-000000000002")}commit;`,"MOVE_LOCK_HELD");
await moving.ready;
const start=Date.now();const claiming=session("select count(*) from public.claim_publisher_deliveries(2,100,300);",null);
const moved=await moving.done;const claimed=await claiming.done;
assert.ok(moved.includes('"replayed": false'));assert.equal(claimed.trim(),"0");assert.ok(Date.now()-start>1000);
// Reset only the disposable race fixture, then hold a worker claim open.
sql(`update public.publisher_content_items set scheduled_at=now()-interval '1 hour' where id='${id}';update public.publisher_deliveries set next_attempt_at=now()-interval '1 hour' where content_item_id='${id}';`);
const worker=session(`begin;select count(*) from public.claim_publisher_deliveries(2,100,300);
\\echo CLAIM_HELD
select pg_sleep(2);commit;`,"CLAIM_HELD");
await worker.ready;const lateMove=session(moveCall("90000000-0000-4000-8000-000000000003"),null);
await worker.done;await assert.rejects(lateMove.done,/not safely reschedulable/);
assert.equal(sql(`select attempt_count from public.publisher_deliveries where content_item_id='${id}';`).trim(),"1");
console.log("PASS: move-first makes old-due worker wait then claim zero; claim-first makes move wait then reject, preserving the single worker lease.");
