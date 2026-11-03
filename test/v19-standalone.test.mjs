import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {saveMedia} from '../src/media.mjs';
import {accountPublisher} from '../src/worker.mjs';
import {processDuePosts} from '../src/scheduler.mjs';
import {encryptToken} from '../src/linkedin.mjs';

const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
const future=()=>new Date(Date.now()+7200000).toISOString();
function addAccount(store,id='alpha',key='unused') {
  store.upsertAccount({id,personUrn:'urn:li:person:'+id,displayName:'Profile '+id,
    encryptedToken:key,expiresAt:new Date(Date.now()+86400000).toISOString()});
}
function addMedia(store,id,accountId='alpha',kind='image') {
  store.saveAttachment({id,accountId,filename:id+'.'+(kind==='image'?'png':'pdf'),
    mime:kind==='image'?'image/png':'application/pdf',kind,size:PNG.length});
}

test('v19 standalone SQLite: ordered images, atomic batch, legacy attachments and restart',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'v19-sqlite-')),file=path.join(dir,'jobs.sqlite');
  let store=new Store(file);
  try{
    addAccount(store);addAccount(store,'beta');
    for(let i=0;i<21;i++)addMedia(store,'img'+i);
    addMedia(store,'doc', 'alpha','document');
    assert.throws(()=>store.scheduleBatch({accountIds:['alpha'],content:'invalid',scheduledAt:future(),
      attachmentIds:{alpha:Array.from({length:21},(_,i)=>'img'+i)}}),/1–20/);
    assert.throws(()=>store.scheduleBatch({accountIds:['alpha'],content:'invalid',scheduledAt:future(),
      attachmentIds:{alpha:['img0','doc']}}),/Multiple attachments/);
    const job=store.scheduleBatch({accountIds:['alpha'],content:'Images',scheduledAt:future(),
      attachmentIds:{alpha:Array.from({length:20},(_,i)=>'img'+i)}})[0];
    assert.equal(store.attachmentsForJob(job).length,20);
    assert.deepEqual(store.attachmentsForJob(job).map(x=>x.id),Array.from({length:20},(_,i)=>'img'+i));
    assert.match(store.listJobs()[0].attachment_name,/img19.png/);
    assert.throws(()=>store.scheduleBatch({accountIds:['alpha'],content:'Again',scheduledAt:future(),
      attachmentIds:{alpha:'img0'}}),/Invalid attachment/);
    addMedia(store,'beta-image','beta');
    assert.throws(()=>store.scheduleBatch({accountIds:['beta','alpha'],content:'Batch',scheduledAt:future(),
      attachmentIds:{beta:'beta-image',alpha:'img0'}}),/Invalid attachment/);
    assert.equal(store.listJobs().length,1);
    assert.equal(store.getAttachment('beta-image').job_id,null);
    store.close();store=new Store(file);
    assert.equal(store.attachmentsForJob(job).length,20);
    assert.equal(store.listJobs()[0].status,'scheduled');
    // Old single-media jobs remain readable after schema migration.
    const old=store.schedule({accountId:'beta',content:'Legacy',scheduledAt:future()});
    store.db.prepare('UPDATE attachments SET job_id=? WHERE id=?').run(old,'beta-image');
    assert.equal(store.attachmentForJob(old).id,'beta-image');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('v19 standalone SQLite: independent time zones, skipped-day notices and scheduled edit',()=>{
  const store=new Store(':memory:');
  try{
    addAccount(store);addAccount(store,'beta');
    const preferences={timeZone:'Asia/Singapore',profiles:{alpha:{0:null,1:'10:00',2:'10:00',3:'10:00',4:'10:00',5:'10:00',6:null},beta:{0:null,1:null,2:null,3:'13:00',4:'13:00',5:'13:00',6:null}},
      profileZones:{alpha:'Asia/Singapore',beta:'Africa/Lagos'}};
    assert.equal(store.savePostingPreferences(preferences).profileZones.beta,'Africa/Lagos');
    const day='2030-01-01'; // Tuesday
    const planned=store.scheduleProfileRows({content:'Profile zones',rows:[
      {accountId:'alpha',day,useDefaults:true},
      {accountId:'beta',day,useDefaults:true}
    ]});
    assert.equal(planned.ids.length,1);
    assert.deepEqual(planned.skipped,['beta']);
    const job=planned.ids[0];
    assert.equal(new Date(store.listJobs()[0].scheduled_at).toISOString(),'2030-01-01T02:00:00.000Z');
    store.updateDraft({id:job,content:'Edited scheduled',scheduledAt:'2030-01-02T03:00:00.000Z',schedule:true},'scheduled');
    assert.equal(store.listJobs()[0].content,'Edited scheduled');
    assert.equal(store.listJobs()[0].scheduled_at,'2030-01-02T03:00:00.000Z');
    store.db.prepare("UPDATE jobs SET status='publishing' WHERE id=?").run(job);
    assert.throws(()=>store.updateDraft({id:job,content:'too late',scheduledAt:future(),schedule:true},'scheduled'),/already publishing/);
  }finally{store.close();}
});

test('v19 standalone SQLite: edited scheduled posts retain ordered media; drafts can replace media',()=>{
  const store=new Store(':memory:');
  try{
    addAccount(store);
    for(const id of ['m0','m1','m2'])addMedia(store,id);
    const job=store.scheduleBatch({accountIds:['alpha'],content:'Before',scheduledAt:future(),
      attachmentIds:{alpha:['m0','m1']}})[0];
    assert.deepEqual(store.attachmentsForJob(job).map(x=>x.id),['m0','m1']);
    store.updateDraft({id:job,content:'After',scheduledAt:future(),schedule:true},'scheduled');
    assert.deepEqual(store.attachmentsForJob(job).map(x=>x.id),['m0','m1']);
    store.changeJobState(job,'draft');
    assert.equal(store.listJobs()[0].status,'draft');
    store.updateDraft({id:job,content:'Final',attachmentId:'m2'});
    assert.deepEqual(store.attachmentsForJob(job).map(x=>x.id),['m2']);
    assert.equal(store.listJobs()[0].content,'Final');
    store.updateDraft({id:job,content:'Final scheduled',scheduledAt:future(),schedule:true});
    assert.equal(store.listJobs()[0].status,'scheduled');
  }finally{store.close();}
});

test('v19 standalone worker publishes ordered 2-image post once and cleans all files',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'v19-worker-'));
  const key=crypto.randomBytes(32).toString('base64');
  const store=new Store(':memory:');
  try{
    addAccount(store,'alpha',encryptToken('token',key));
    const names=[crypto.randomUUID(),crypto.randomUUID()];
    for(const id of names){addMedia(store,id);await saveMedia(dir,id,PNG);}
    const id=store.schedule({accountId:'alpha',content:'Two images',scheduledAt:future(),attachmentId:names});
    let initialized=0,uploaded=0,posted=0;
    const fake=async(url,init)=>{
      if(url.includes('images?action=initializeUpload')){
        initialized++;return new Response(JSON.stringify({value:{uploadUrl:'https://www.linkedin.com/fixture-upload/'+initialized,
          image:'urn:li:image:img'+initialized}}),{status:200});
      }
      if(url.includes('/fixture-upload/')){uploaded++;assert.deepEqual(Buffer.from(init.body),PNG);return new Response('',{status:201});}
      if(url.endsWith('/rest/posts')){
        posted++;assert.deepEqual(JSON.parse(init.body).content.multiImage.images.map(x=>x.id),['urn:li:image:img1','urn:li:image:img2']);
        return new Response('',{status:201,headers:{'x-restli-id':'urn:li:share:ok'}});
      }
      throw Error('Unexpected '+url);
    };
    const result=await processDuePosts({storage:store,publisher:accountPublisher(store,{TOKEN_ENCRYPTION_KEY:key,MEDIA_DIR:dir},fake),
      now:()=>new Date(Date.now()+10800000)});
    assert.equal(result[0].status,'published');
    assert.equal(initialized,2);assert.equal(uploaded,2);assert.equal(posted,1);
    assert.equal(store.listJobs()[0].status,'published');
    for(const name of names)assert.equal(existsSync(path.join(dir,name)),false);
    assert.equal(store.attachmentsForJob(id).length,2);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('v19 standalone authenticated routes: profile time, media preview, scheduled edit and CSRF',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'v19-http-'));
  const origin='http://127.0.0.1:3297';
  const key=crypto.randomBytes(32).toString('base64');
  const env={APP_ORIGIN:origin,ADMIN_PASSWORD:'test-only',LINKEDIN_CLIENT_ID:'demo',
    LINKEDIN_CLIENT_SECRET:'demo',TOKEN_ENCRYPTION_KEY:key,DATABASE_PATH:':memory:',MEDIA_DIR:dir};
  const {server,store}=createApp({env});
  await new Promise(resolve=>server.listen(3297,'127.0.0.1',resolve));
  let cookie='',csrf='';
  const call=async(url,method='GET',body,opts={})=>{
    const headers={cookie,origin,...(method==='POST'?{'Content-Type':'application/json','x-csrf-token':csrf}:{}),...opts};
    const res=await fetch(origin+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const type=res.headers.get('content-type')||'';
    return {status:res.status,data:type.includes('application/json')?await res.json():await res.arrayBuffer(),res};
  };
  try{
    addAccount(store,'alpha',encryptToken('token',key));
    const imageId=crypto.randomUUID();
    addMedia(store,imageId);
    await saveMedia(dir,imageId,PNG);
    assert.equal((await call('/api/media/'+imageId)).status,401);
    const login=await call('/api/login','POST',{password:'test-only'});
    assert.equal(login.status,200);
    cookie=login.res.headers.get('set-cookie').split(';')[0];
    csrf=login.data.csrf;
    assert.equal((await call('/api/media/'+imageId)).status,200);
    assert.equal((await call('/api/profile-jobs','POST',{rows:[{accountId:'alpha',day:'2030-01-02',useDefaults:true}],content:'HTTP image',attachmentIds:{alpha:imageId}},{'x-csrf-token':'invalid'})).status,403);
    const batch=await call('/api/profile-jobs','POST',{rows:[{accountId:'alpha',day:'2030-01-02',useDefaults:true}],content:'HTTP image',attachmentIds:{alpha:imageId}});
    assert.equal(batch.status,201);
    assert.equal(batch.data.ids.length,1);
    let status=await call('/api/status');
    assert.equal(status.data.jobs.length,1);
    assert.equal(status.data.jobs[0].attachments[0].id,imageId);
    const id=batch.data.ids[0];
    const edit=await call('/api/edit-post','POST',{id,content:'Edited HTTP',scheduledAt:'2030-01-03T02:00:00.000Z'});
    assert.equal(edit.status,200);
    status=await call('/api/status');
    assert.equal(status.data.jobs[0].content,'Edited HTTP');
    assert.equal(status.data.jobs[0].attachments[0].id,imageId);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});