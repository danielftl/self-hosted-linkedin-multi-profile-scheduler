import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Store } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';

const future=()=>new Date(Date.now()+3600000).toISOString();
function addAccounts(store){
  for(const id of ['alpha','beta','gamma']){
    store.upsertAccount({id,displayName:'Profile '+id,personUrn:'urn:li:person:'+id,
      encryptedToken:'encrypted',expiresAt:new Date(Date.now()+7200000).toISOString()});
  }
}
test('multi-profile scheduling is atomic and creates a separate job for each profile',()=>{
  const store=new Store(':memory:');
  try{
    addAccounts(store);
    const ids=store.scheduleBatch({accountIds:['alpha','beta','gamma'],content:'Same post',scheduledAt:future()});
    assert.equal(ids.length,3);
    assert.equal(new Set(ids).size,3);
    assert.deepEqual(store.listJobs().map(j=>j.account_id).sort(),['alpha','beta','gamma']);
    assert.throws(()=>store.scheduleBatch({accountIds:['alpha','missing'],content:'should roll back',scheduledAt:future()}),/Reconnect/);
    assert.equal(store.listJobs().length,3);
    assert.throws(()=>store.scheduleBatch({accountIds:['alpha','alpha'],content:'duplicate',scheduledAt:future()}),/valid profiles/);
    assert.equal(store.listJobs().length,3);
  }finally{store.close();}
});
test('one attachment per profile is attached atomically; failed batch does not consume media',()=>{
  const store=new Store(':memory:');
  try{
    addAccounts(store);
    for(const id of ['alpha','beta'])store.saveAttachment({
      id:'media-'+id,accountId:id,filename:'photo.png',mime:'image/png',kind:'image',size:100
    });
    assert.throws(()=>store.scheduleBatch({accountIds:['alpha','gamma'],content:'bad',scheduledAt:future(),
      attachmentIds:{alpha:'media-alpha',gamma:'media-beta'}}),/Invalid attachment/);
    assert.equal(store.listJobs().length,0);
    assert.equal(store.getAttachment('media-alpha').job_id,null);
    const ids=store.scheduleBatch({accountIds:['alpha','beta'],content:'Photo',scheduledAt:future(),
      attachmentIds:{alpha:'media-alpha',beta:'media-beta'}});
    assert.equal(ids.length,2);
    assert.equal(store.listJobs().filter(j=>j.attachment_name==='photo.png').length,2);
    assert.throws(()=>store.scheduleBatch({accountIds:['alpha'],content:'Again',scheduledAt:future(),
      attachmentIds:{alpha:'media-alpha'}}),/Invalid attachment/);
  }finally{store.close();}
});
test('authenticated batch API schedules multiple jobs and rejects unauthorized access',async()=>{
  const origin='http://127.0.0.1:3190';
  const env={APP_ORIGIN:origin,ADMIN_PASSWORD:'test-pass',LINKEDIN_CLIENT_ID:'test-client',LINKEDIN_CLIENT_SECRET:'test-secret',
    TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),DATABASE_PATH:':memory:'};
  const {server,store}=createApp({env});addAccounts(store);
  await new Promise(resolve=>server.listen(3190,'127.0.0.1',resolve));
  try{
    const payload={accountIds:['alpha','beta'],content:'Batch HTTP',scheduledAt:future()};
    const request=(cookie='',csrf='')=>fetch(origin+'/api/batch-jobs',{
      method:'POST',headers:{origin,'content-type':'application/json',cookie,'x-csrf-token':csrf},
      body:JSON.stringify(payload)
    });
    assert.equal((await request()).status,401);
    const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({password:'test-pass'})});
    const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf;
    assert.equal((await request(cookie,'bad')).status,403);
    const result=await request(cookie,csrf);
    assert.equal(result.status,201);
    assert.equal((await result.json()).ids.length,2);
    assert.equal(store.listJobs().length,2);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
