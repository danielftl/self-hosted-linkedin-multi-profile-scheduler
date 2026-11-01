import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Store } from '../src/store.mjs';
import { processDuePosts } from '../src/scheduler.mjs';
import { accountPublisher } from '../src/worker.mjs';
import { encryptToken } from '../src/linkedin.mjs';

function addAccount(store,id='person1',token='token',key=crypto.randomBytes(32).toString('base64')) {
  store.upsertAccount({id,displayName:id,personUrn:'urn:li:person:'+id,
    encryptedToken:encryptToken(token,key),expiresAt:new Date(Date.now()+3600000).toISOString()});
  return key;
}

test('two workers cannot claim the same scheduled post',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'buffer-claim-'));
  const file=path.join(dir,'jobs.sqlite');
  const first=new Store(file),second=new Store(file);
  try {
    addAccount(first);
    first.schedule({accountId:'person1',content:'Once only',scheduledAt:new Date(0).toISOString()});
    const [a,b]=await Promise.all([first.claimDue(new Date()),second.claimDue(new Date())]);
    assert.equal([a,b].filter(Boolean).length,1);
    await first.markPublished(a?.id ?? b.id,'remote-1');
    assert.equal(second.listJobs()[0].status,'published');
    assert.equal(await second.claimDue(new Date()),null);
  }finally{first.close();second.close();rmSync(dir,{recursive:true,force:true});}
});

test('expired publishing lease is marked uncertain, never resent',async()=>{
  const store=new Store(':memory:');
  try {
    addAccount(store);
    store.schedule({accountId:'person1',content:'No duplicate',scheduledAt:new Date(0).toISOString()});
    const claimed=await store.claimDue(new Date(0));
    assert.ok(claimed);
    const later=new Date(6*60*1000);
    let published=0;
    const outcomes=await processDuePosts({storage:store,now:()=>later,publisher:async()=>{published++;return {postId:'should-not-publish'};}});
    assert.equal(published,0);
    assert.deepEqual(outcomes,[]);
    assert.equal(store.listJobs()[0].status,'uncertain');
  }finally{store.close();}
});

test('HTTP 503 leaves a post uncertain rather than risk a duplicate',async()=>{
  const store=new Store(':memory:');
  try {
    addAccount(store);
    store.schedule({accountId:'person1',content:'Ambiguous',scheduledAt:new Date(0).toISOString()});
    let calls=0;
    await processDuePosts({storage:store,publisher:async()=>{calls++;const e=Error('upstream');e.status=503;throw e;}});
    assert.equal(calls,1);
    assert.equal(store.listJobs()[0].status,'uncertain');
    await processDuePosts({storage:store,publisher:async()=>{calls++;return {postId:'unexpected'};}});
    assert.equal(calls,1);
  }finally{store.close();}
});

test('HTTP 429 retries, but stops after four attempts',async()=>{
  const store=new Store(':memory:');
  try {
    addAccount(store);
    store.schedule({accountId:'person1',content:'Rate limited',scheduledAt:new Date(0).toISOString()});
    let current=new Date(10*60*1000),calls=0;
    for(let attempt=0;attempt<4;attempt++){
      await processDuePosts({storage:store,now:()=>current,publisher:async()=>{calls++;const e=Error('limited');e.status=429;throw e;}});
      current=new Date(current.getTime()+2*60*60*1000);
    }
    assert.equal(calls,4);
    assert.equal(store.listJobs()[0].status,'failed');
    await processDuePosts({storage:store,now:()=>current,publisher:async()=>{calls++;return {postId:'unexpected'};}});
    assert.equal(calls,4);
  }finally{store.close();}
});

test('LinkedIn 401 requires reconnect and never republishes with an invalid token',async()=>{
  const store=new Store(':memory:');
  try {
    const key=addAccount(store);
    store.schedule({accountId:'person1',content:'Authorization expired',scheduledAt:new Date(0).toISOString()});
    let calls=0;
    const mock=async()=>{calls++;return new Response(JSON.stringify({error:'invalid token'}),{status:401});};
    const results=await processDuePosts({storage:store,publisher:accountPublisher(store,{TOKEN_ENCRYPTION_KEY:key},mock)});
    assert.equal(results[0].status,'failed');
    assert.equal(calls,1);
    assert.equal(store.listJobs()[0].status,'failed');
    assert.ok(Date.parse(store.getAccount('person1').expires_at)<=Date.now());
  }finally{store.close();}
});
