import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { encryptToken } from '../src/linkedin.mjs';
import { accountPublisher } from '../src/worker.mjs';
import { processDuePosts } from '../src/scheduler.mjs';
import { validateUpload } from '../src/media.mjs';
import { publishLinkedInMedia } from '../src/linkedin-media.mjs';

const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
const PDF=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
test('video upload splits parts, finalizes, then creates a video post',async()=>{
  const video=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftyp'),Buffer.alloc(10)]);
  assert.equal(validateUpload({filename:'clip.mp4',mime:'video/mp4',buffer:video}).kind,'video');
  let part=0,finalized=false,posted=false;
  const mock=async(url,options)=>{
    if(url.includes('videos?action=initializeUpload')){
      assert.equal(JSON.parse(options.body).initializeUploadRequest.fileSizeBytes,video.length);
      return new Response(JSON.stringify({value:{video:'urn:li:video:vid123',uploadToken:'session',
        uploadInstructions:[
          {firstByte:0,lastByte:7,uploadUrl:'https://www.linkedin.com/dms-uploads/part1'},
          {firstByte:8,lastByte:video.length-1,uploadUrl:'https://www.linkedin.com/dms-uploads/part2'}
        ]}}),{status:200});
    }
    if(url.includes('/dms-uploads/')){
      part++;assert.equal(options.method,'PUT');
      return new Response('',{status:201,headers:{etag:'"part'+part+'"'}});
    }
    if(url.includes('videos?action=finalizeUpload')){
      finalized=true;const body=JSON.parse(options.body).finalizeUploadRequest;
      assert.deepEqual(body.uploadedPartIds,['part1','part2']);
      return new Response('{}',{status:200});
    }
    if(url.endsWith('/rest/posts')){
      posted=true;assert.equal(JSON.parse(options.body).content.media.id,'urn:li:video:vid123');
      return new Response('',{status:201,headers:{'x-restli-id':'urn:li:share:video'}});
    }
    throw Error('Unexpected URL '+url);
  };
  const result=await publishLinkedInMedia({accessToken:'token',personUrn:'urn:li:person:person1',
    text:'Video',attachment:{kind:'video',filename:'clip.mp4',mime:'video/mp4',size:video.length},
    bytes:video,fetchImpl:mock});
  assert.equal(result.postId,'urn:li:share:video');
  assert.equal(part,2);assert.equal(finalized,true);assert.equal(posted,true);
});

test('document upload uses LinkedIn document URN and creates a document post',async()=>{
  const calls=[];
  const mock=async(url,options)=>{
    calls.push({url,options});
    if(url.includes('documents?action=initializeUpload'))return new Response(JSON.stringify({value:{
      uploadUrl:'https://www.linkedin.com/dms-uploads/document',document:'urn:li:document:doc123'
    }}),{status:200});
    if(url.includes('/dms-uploads/'))return new Response('',{status:201});
    if(url.endsWith('/rest/posts'))return new Response('',{status:201,headers:{'x-restli-id':'urn:li:share:docpost'}});
    throw Error('Unexpected URL');
  };
  const result=await publishLinkedInMedia({accessToken:'token',personUrn:'urn:li:person:person1',
    text:'Read this',attachment:{kind:'document',filename:'report.pdf',mime:'application/pdf',size:PDF.length},
    bytes:PDF,fetchImpl:mock});
  assert.equal(result.postId,'urn:li:share:docpost');
  const post=JSON.parse(calls[2].options.body);
  assert.equal(post.content.media.id,'urn:li:document:doc123');
  assert.equal(post.content.media.title,'report.pdf');
  assert.equal(calls[1].options.method,'PUT');
  await assert.rejects(publishLinkedInMedia({accessToken:'token',personUrn:'urn:li:person:person1',
    text:'x',attachment:{kind:'document',filename:'report.pdf',mime:'application/pdf',size:PDF.length},
    bytes:PDF,fetchImpl:async()=>new Response(JSON.stringify({value:{uploadUrl:'https://evil.example/steal',document:'urn:li:document:doc123'}}),{status:200})}),/Unexpected LinkedIn upload destination/);
});

test('upload file validation rejects unsupported and spoofed media',()=>{
  assert.equal(validateUpload({filename:'photo.png',mime:'image/png',buffer:PNG}).kind,'image');
  assert.equal(validateUpload({filename:'guide.pdf',mime:'application/pdf',buffer:PDF}).kind,'document');
  assert.throws(()=>validateUpload({filename:'virus.exe',mime:'image/png',buffer:PNG}),/Unsupported/);
  assert.throws(()=>validateUpload({filename:'fake.png',mime:'image/png',buffer:PDF}),/Invalid PNG/);
  assert.throws(()=>validateUpload({filename:'empty.pdf',mime:'application/pdf',buffer:Buffer.alloc(0)}),/size/);
});

test('local image attachment survives scheduling, publishes, then is deleted',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'buffer-media-'));
  const origin='http://127.0.0.1:3187';
  const key=crypto.randomBytes(32).toString('base64');
  const env={APP_ORIGIN:origin,DATABASE_PATH:':memory:',MEDIA_DIR:dir,
    ADMIN_PASSWORD:'test-password',LINKEDIN_CLIENT_ID:'client',LINKEDIN_CLIENT_SECRET:'secret',TOKEN_ENCRYPTION_KEY:key};
  let published=0,uploaded=0;
  const mockFetch=async(url,init)=>{
    if(url.includes('images?action=initializeUpload'))return new Response(JSON.stringify({value:{
      uploadUrl:'https://www.linkedin.com/dms-uploads/fake',
      image:'urn:li:image:fake123'
    }}),{status:200});
    if(url.includes('/dms-uploads/')){uploaded++;assert.equal(init.method,'PUT');assert.deepEqual(Buffer.from(init.body),PNG);return new Response('',{status:201});}
    if(url.endsWith('/rest/posts')){
      published++;const payload=JSON.parse(init.body);
      assert.equal(payload.content.media.id,'urn:li:image:fake123');
      assert.equal(payload.author,'urn:li:person:person1');
      return new Response('',{status:201,headers:{'x-restli-id':'urn:li:share:123'}});
    }
    throw Error('Unexpected URL '+url);
  };
  const {server,store}=createApp({env,fetchImpl:mockFetch});
  await new Promise(resolve=>server.listen(3187,'127.0.0.1',resolve));
  let cookie='',csrf='';
  const call=async(endpoint,method='GET',data,extra={})=>{
    const headers={cookie,origin};
    if(data && !(data instanceof Buffer))headers['Content-Type']='application/json';
    if(method==='POST')headers['x-csrf-token']=csrf;
    Object.assign(headers,extra);
    const res=await fetch(origin+endpoint,{method,headers,body:data instanceof Buffer?data:(data?JSON.stringify(data):undefined)});
    let json={};try{json=await res.json();}catch{}
    return {res,json};
  };
  try{
    store.upsertAccount({id:'person1',displayName:'Tester',personUrn:'urn:li:person:person1',
      encryptedToken:encryptToken('test-token',key),expiresAt:new Date(Date.now()+3600000).toISOString()});
    assert.equal((await call('/api/uploads','POST',PNG,{'Content-Type':'image/png','x-file-name':'photo.png','x-account-id':'person1'})).res.status,401);
    const login=await call('/api/login','POST',{password:'test-password'});
    cookie=login.res.headers.get('set-cookie').split(';')[0];csrf=login.json.csrf;
    assert.equal((await call('/api/uploads','POST',PNG,{'Content-Type':'image/png','x-file-name':'photo.png','x-account-id':'person1','x-csrf-token':'wrong'})).res.status,403);
    const upload=await call('/api/uploads','POST',PNG,{'Content-Type':'image/png','x-file-name':'photo.png','x-account-id':'person1'});
    assert.equal(upload.res.status,201);
    assert.equal(existsSync(path.join(dir,upload.json.uploadId)),true);
    const future=new Date(Date.now()+3600000).toISOString();
    const scheduled=await call('/api/jobs','POST',{accountId:'person1',content:'Image test',scheduledAt:future,attachmentId:upload.json.uploadId});
    assert.equal(scheduled.res.status,201);
    assert.equal((await call('/api/jobs','POST',{accountId:'person1',content:'duplicate',scheduledAt:future,attachmentId:upload.json.uploadId})).res.status,400);
    assert.equal(store.listJobs()[0].attachment_name,'photo.png');
    const outcomes=await processDuePosts({storage:store,publisher:accountPublisher(store,env,mockFetch),now:()=>new Date(Date.now()+7200000)});
    assert.equal(outcomes[0].status,'published');
    assert.equal(published,1);assert.equal(uploaded,1);
    assert.equal(existsSync(path.join(dir,upload.json.uploadId)),false);
    assert.ok(store.getAttachment(upload.json.uploadId).deleted_at);
    await processDuePosts({storage:store,publisher:accountPublisher(store,env,mockFetch),now:()=>new Date(Date.now()+7200000)});
    assert.equal(published,1);
  }finally{await new Promise(resolve=>server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
});
