import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { encryptToken } from '../src/linkedin.mjs';

test('cloud scheduler trigger is secret-protected, bounded and idempotent',async()=>{
  const port=3186,origin='http://127.0.0.1:'+port;
  const key=crypto.randomBytes(32).toString('base64');
  const secret=crypto.randomBytes(32).toString('base64url');
  let posts=0;
  const fetchImpl=async(url)=>{
    if(!url.endsWith('/rest/posts')) throw Error('Unexpected outbound request');
    posts++;
    return new Response('',{status:201,headers:{'x-restli-id':'urn:li:share:'+posts}});
  };
  const env={APP_ORIGIN:origin,ADMIN_PASSWORD:'test',DATABASE_PATH:':memory:',
    LINKEDIN_CLIENT_ID:'client',LINKEDIN_CLIENT_SECRET:'secret',TOKEN_ENCRYPTION_KEY:key,
    SCHEDULER_TRIGGER_SECRET:secret};
  const {server,store}=createApp({env,fetchImpl});
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  const call=async(header)=>fetch(origin+'/internal/run-due',{
    method:'POST',headers:header?{'x-scheduler-secret':header}:{}
  });
  try{
    store.upsertAccount({id:'member',displayName:'Member',personUrn:'urn:li:person:member',
      encryptedToken:encryptToken('test-token',key),expiresAt:new Date(Date.now()+3600000).toISOString()});
    for(let i=0;i<12;i++)store.schedule({accountId:'member',content:'Queued '+i,scheduledAt:new Date(0).toISOString()});
    assert.equal((await call()).status,403);
    assert.equal((await call('incorrect')).status,403);
    assert.equal(posts,0);
    const first=await call(secret);assert.equal(first.status,200);
    assert.equal((await first.json()).processed,10);
    assert.equal(posts,10);
    const second=await call(secret);assert.equal(second.status,200);
    assert.equal((await second.json()).processed,2);
    assert.equal(posts,12);
    const third=await call(secret);assert.equal(third.status,200);
    assert.equal((await third.json()).processed,0);
    assert.equal(posts,12);
    assert.equal(store.listJobs().filter(j=>j.status==='published').length,12);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
