import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { D1Store } from '../src/d1-store.mjs';

function mockD1() {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../infra/d1-schema.sql',import.meta.url),'utf8'));
  const wrapper={
    async batch(statements){
      db.exec('BEGIN IMMEDIATE');
      try{
        const results=[];
        for(const statement of statements)results.push(await statement.run());
        db.exec('COMMIT');return results;
      }catch(e){db.exec('ROLLBACK');throw e;}
    },
    prepare(sql) {
      const statement=db.prepare(sql);
      return {
        bind(...params) {
          return {
            async first(){return statement.get(...params)??null;},
            async all(){return {results:statement.all(...params)};},
            async run(){const result=statement.run(...params);return {meta:{changes:result.changes}};}
          };
        },
        async first(){return statement.get()??null;},
        async all(){return {results:statement.all()};},
        async run(){const result=statement.run();return {meta:{changes:result.changes}};}
      };
    }
  };
  return {db,wrapper};
}

test('D1 adapter implements persistent sessions, throttling and single-claim queue',async()=>{
  const {db,wrapper}=mockD1();
  const store=new D1Store(wrapper);
  try{
    const token='random-session-token',csrf='csrf';
    await store.createSession(token,csrf,new Date(Date.now()+600000).toISOString());
    assert.equal((await store.getSession(token)).csrf,csrf);
    assert.equal(await store.getSession('wrong'),null);
    await store.setSessionOAuth(token,'state',new Date(Date.now()+60000).toISOString());
    assert.equal(await store.consumeSessionOAuth(token,'wrong'),false);
    assert.equal(await store.consumeSessionOAuth(token,'state'),true);
    assert.equal(await store.consumeSessionOAuth(token,'state'),false);
    await store.revokeSession(token);
    assert.equal(await store.getSession(token),null);
    for(let i=0;i<10;i++)await store.recordLoginFailure('127.0.0.1');
    assert.equal(await store.loginBlocked('127.0.0.1'),true);
    assert.equal(await store.loginBlocked('127.0.0.2'),false);
    await store.clearLoginFailures('127.0.0.1');
    assert.equal(await store.loginBlocked('127.0.0.1'),false);
    await store.upsertAccount({id:'member',displayName:'Profile',personUrn:'urn:li:person:member',
      encryptedToken:'encrypted',expiresAt:new Date(Date.now()+600000).toISOString()});
    assert.equal((await store.listAccounts()).length,1);
    assert.equal((await store.getAccount('member')).display_name,'Profile');
    const id=await store.schedule({accountId:'member',content:'Test scheduled post',scheduledAt:new Date(0).toISOString()});
    const claim=await store.claimDue(new Date());
    assert.equal(claim.id,id);
    assert.equal(await store.claimDue(new Date()),null);
    await store.markPublished(id,'remote-post');
    assert.equal((await store.listJobs())[0].status,'published');
    assert.equal((await store.listJobs())[0].remote_post_id,'remote-post');
    await store.saveAttachment({id:'media-1',accountId:'member',filename:'photo.png',mime:'image/png',kind:'image',size:50});
    const mediaJob=await store.schedule({accountId:'member',content:'Image',scheduledAt:new Date(0).toISOString(),attachmentId:'media-1'});
    assert.equal((await store.attachmentForJob(mediaJob)).filename,'photo.png');
    assert.equal((await store.listJobs()).find(j=>j.id===mediaJob).attachment_name,'photo.png');
    await assert.rejects(store.schedule({accountId:'member',content:'duplicate',scheduledAt:new Date(0).toISOString(),attachmentId:'media-1'}),/Invalid attachment/);
    await store.markAttachmentDeleted('media-1');
    assert.ok((await store.getAttachment('media-1')).deleted_at);
  }finally{db.close();}
});

test('D1 adapter does not republish stale claims',async()=>{
  const {db,wrapper}=mockD1();
  const store=new D1Store(wrapper);
  try{
    await store.upsertAccount({id:'member',displayName:'Profile',personUrn:'urn:li:person:member',
      encryptedToken:'encrypted',expiresAt:new Date(Date.now()+600000).toISOString()});
    const id=await store.schedule({accountId:'member',content:'Test scheduled post',scheduledAt:new Date(0).toISOString()});
    assert.equal((await store.claimDue(new Date(0))).id,id);
    assert.equal(await store.claimDue(new Date(6*60000)),null);
    assert.equal((await store.listJobs())[0].status,'uncertain');
  }finally{db.close();}
});

test('D1 batch schedules two profiles atomically',async()=>{
  const {db,wrapper}=mockD1(),store=new D1Store(wrapper);
  try{
    for(const id of ['one','two'])await store.upsertAccount({id,displayName:id,personUrn:'urn:li:person:'+id,
      encryptedToken:'encrypted',expiresAt:new Date(Date.now()+7200000).toISOString()});
    const time=new Date(Date.now()+3600000).toISOString();
    const ids=await store.scheduleBatch({accountIds:['one','two'],content:'Shared',scheduledAt:time});
    assert.equal(ids.length,2);
    assert.equal((await store.listJobs()).length,2);
    await assert.rejects(store.scheduleBatch({accountIds:['one','bad'],content:'Should not insert',scheduledAt:time}),/Reconnect/);
    assert.equal((await store.listJobs()).length,2);
    for(const id of ['one','two'])await store.saveAttachment({id:'media-'+id,accountId:id,
      filename:'photo.png',mime:'image/png',kind:'image',size:60});
    const mediaIds=await store.scheduleBatch({accountIds:['one','two'],content:'Photo',scheduledAt:time,
      attachmentIds:{one:'media-one',two:'media-two'}});
    assert.equal(mediaIds.length,2);
    assert.equal((await store.listJobs()).filter(j=>j.attachment_name==='photo.png').length,2);
  }finally{db.close();}
});
