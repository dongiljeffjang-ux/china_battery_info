import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test';
const {acquireRun,releaseRun,claimStage,withSearchBudget,takeSearchBudget}=await import('../lib/ingestion-guard.js');
const rows=new Map();
globalThis.fetch=async(url,opts)=>{
  const query=new URL(url).searchParams;
  const body=opts.body?JSON.parse(opts.body):null;
  let result=[];
  if(opts.method==='POST') {
    if(!rows.has(body.key)){ rows.set(body.key,{...body});result=[body]; }
  } else {
    const keyFilter=query.get('key'), owner=query.get('owner')?.slice(3), expiry=query.get('expires_at');
    for(const [key,row] of [...rows]){
      if(keyFilter&&(keyFilter.startsWith('eq.')?key!==keyFilter.slice(3):key===keyFilter.slice(4)))continue;
      if(owner&&row.owner!==owner)continue;
      if(expiry&&!(expiry.startsWith('lt.')?row.expires_at<expiry.slice(3):row.expires_at>expiry.slice(3)))continue;
      if(opts.method==='PATCH'){Object.assign(row,body);result.push(row);}
      if(opts.method==='DELETE')rows.delete(key);
    }
  }
  return Response.json(result);
};
const attempts=await Promise.all([acquireRun(),acquireRun(),acquireRun()]);
assert.equal(attempts.filter(Boolean).length,1);
const owner=attempts.find(Boolean);
assert.equal(await claimStage(owner,'process',1),true);
assert.equal(await claimStage(owner,'process',1),false);
await releaseRun(crypto.randomUUID());assert.equal(await acquireRun(),null);
rows.get('collection').expires_at='2000-01-01T00:00:00.000Z';
const next=await acquireRun();assert.ok(next);assert.notEqual(owner,next);
await releaseRun(owner);assert.equal(await acquireRun(),null);
assert.equal(rows.has(`${owner}:process:1`),false,'stage claims are removed with the run');
await releaseRun(next);assert.ok(await acquireRun());
await Promise.all([1,2].map(()=>withSearchBudget(async()=>{
  for(let i=0;i<18;i++)takeSearchBudget('search');
  assert.throws(()=>takeSearchBudget('search'),/BUDGET_EXHAUSTED/);
  for(let i=0;i<4;i++)takeSearchBudget('recovery');
  assert.throws(()=>takeSearchBudget('recovery'),/BUDGET_EXHAUSTED/);
})));
console.log('Concurrent ownership, stage deduplication, expiry, stale release and isolated budgets passed');
