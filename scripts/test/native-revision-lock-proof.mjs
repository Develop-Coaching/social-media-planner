// Local Docker only. Two real database sessions prove revision/worker serialization.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
const container=process.env.NATIVE_REVISION_TEST_CONTAINER || 'supabase_db_native-reel-revision-41';
if (!/^supabase_db_/.test(container)) throw new Error('Only a local Supabase Docker container is supported');
const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-At'];
function sql(query) {return execFileSync('docker',args,{input:query,encoding:'utf8'});}
function session(query,marker) {
  const child=spawn('docker',args); let output='',errors='',readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  child.stdout.on('data',chunk=>{output+=chunk; if(marker && output.includes(marker)) readyResolve();});
  child.stderr.on('data',chunk=>{errors+=chunk;}); child.stdin.end(query);
  const done=new Promise((resolve,reject)=>{child.on('exit',code=>code===0?resolve(output):reject(new Error(errors)));child.on('error',reject);});
  return {ready,done};
}
sql(`insert into public.companies(user_id,id,name) values('rev-lock-demo','rev-lock-company','Synthetic revision lock proof');
select public.ingest_native_publisher_content('rev-lock-demo','rev-lock-company','greg_brain',s,'reel','Old race caption','{"upload_paths":["rev-lock-demo/rev-lock-company/old.mp4"]}',d,array['facebook','instagram'],'ready',null)
from (values ('rev-lock-first','2099-01-01T08:30Z'::timestamptz),('rev-lock-second','2099-01-03T08:30Z'::timestamptz)) as fixtures(s,d);`);
function revision(source,req,due) {return `select public.revise_native_publisher_content('${req}','rev-lock-demo','rev-lock-company',(select id from public.publisher_content_items where user_id='rev-lock-demo' and source_id='${source}'),2,0,'Replacement race caption','{"upload_paths":["rev-lock-demo/rev-lock-company/new.mp4"]}','${due}','synthetic-race-approval','qa:lock');`;}
const moving=session(`begin;select owner from public.publisher_queue_ownership where source='legacy_spp' for update;
\\echo REVISION_LOCK_HELD
select pg_sleep(2);${revision('rev-lock-first','42000000-0000-4000-8000-000000000001','2099-01-02T08:30Z')}commit;`,'REVISION_LOCK_HELD');
await moving.ready;
const start=Date.now();const claiming=session("select count(*) from public.claim_publisher_deliveries(2,100,300,'2099-01-01T08:30Z');");
assert.ok((await moving.done).includes('"replayed": false')); assert.equal((await claiming.done).trim(),'0'); assert.ok(Date.now()-start>1000);
const worker=session(`begin;select count(*) from public.claim_publisher_deliveries(2,100,300,'2099-01-03T08:30Z');
\\echo CLAIM_LOCK_HELD
select pg_sleep(2);commit;`,'CLAIM_LOCK_HELD');
await worker.ready;
const lateRevision=session(revision('rev-lock-second','42000000-0000-4000-8000-000000000002','2099-01-04T08:30Z'));
const rejected=assert.rejects(lateRevision.done,/only ready unattempted native pending content can be revised/);
await worker.done; await rejected;
assert.equal(sql("select count(*) from public.publisher_deliveries d join public.publisher_content_items ci on ci.id=d.content_item_id where ci.source_id='rev-lock-second' and d.state='leased' and d.attempt_count=1;").trim(),'2');
assert.equal(sql("select caption from public.publisher_content_items where source_id='rev-lock-second';").trim(),'Old race caption');
console.log('PASS: revision-first blocks old-due worker then claims zero; claim-first blocks revision then refuses it, preserving both worker leases and original caption.');
