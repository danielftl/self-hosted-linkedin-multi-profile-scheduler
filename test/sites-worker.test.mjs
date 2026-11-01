import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Store } from '../src/store.mjs';
import { createSiteHandler } from '../src/sites-worker.mjs';
import { encrypt,decrypt,randomState } from '../src/linkedin-web.mjs';
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');

test('Web Crypto encryption matches existing local token format',async()=>{
  const key=crypto.randomBytes(32).toString('base64');
  const token='token with unusual characters: ä @ $';
  const ciphertext=await encrypt(token,key);
  assert.equal(await decrypt(ciphertext,key),token);
  const {encryptToken,decryptToken}=await import('../src/linkedin.mjs');
  assert.equal(decryptToken(ciphertext,key),token);
  assert.equal(await decrypt(encryptToken(token,key),key),token);
  assert.ok(randomState().length>=40);
});

test('Sites handler connects two profiles and publishes due posts through a native scheduled event',async()=>{
  const store=new Store(':memory:');
  const origin='https://buffer.example.test';
  const key=crypto.randomBytes(32).toString('base64');
  const secret=crypto.randomBytes(32).toString('base64url');
  const media=new Map();
  const env={APP_ORIGIN:origin,ADMIN_PASSWORD:'site-test-password',
    MEDIA:{put:async(id,bytes)=>media.set(id,new Uint8Array(bytes)),
      get:async id=>media.has(id)?{arrayBuffer:async()=>media.get(id).buffer}:null,
      delete:async id=>media.delete(id)},
    LINKEDIN_CLIENT_ID:'test-client',LINKEDIN_CLIENT_SECRET:'test-client-secret',
    TOKEN_ENCRYPTION_KEY:key,SCHEDULER_TRIGGER_SECRET:secret,
    ASSETS:{fetch:async()=>new Response('<html>unchanged UI</html>',{status:200,headers:{'Content-Type':'text/html'}})}};
  let member='first',posted=0;
  const fakeLinkedIn=async(url,init)=>{
    if(url.endsWith('/accessToken'))return new Response(JSON.stringify({
      access_token:'token-'+member,expires_in:3600,scope:'openid profile email w_member_social'
    }),{status:200});
    if(url.endsWith('/userinfo'))return new Response(JSON.stringify({sub:member,name:'Profile '+member}),{status:200});
    if(url.includes('images?action=initializeUpload'))return new Response(JSON.stringify({value:{
      uploadUrl:'https://www.linkedin.com/dms-uploads/fake',image:'urn:li:image:fake'
    }}),{status:200});
    if(url.includes('/dms-uploads/'))return new Response('',{status:201});
    if(url.endsWith('/rest/posts') && JSON.parse(init.body).content?.media){
      posted++;assert.equal(JSON.parse(init.body).content.media.id,'urn:li:image:fake');
      return new Response('{}',{status:201,headers:{'x-restli-id':'urn:li:share:'+posted}});
    }
    if(url.endsWith('/rest/posts')){
      posted++;
      assert.equal(init.method,'POST');
      return new Response('{}',{status:201,headers:{'x-restli-id':'urn:li:share:'+posted}});
    }
    throw Error('Unexpected LinkedIn URL '+url);
  };
  const app=createSiteHandler({storage:store,fetchImpl:fakeLinkedIn});
  let cookie='',csrf='';
  const request=async(path,method='GET',data,extra={})=>{
    const headers={cookie};
    if(method==='POST'&&data!==undefined){
      headers.origin=origin;
      headers['content-type']='application/json';
      headers['x-csrf-token']=csrf;
    }
    Object.assign(headers,extra);
    const res=await app.fetch(new Request(origin+path,{
      method,headers,body:data===undefined?undefined:JSON.stringify(data)
    }),env);
    let body={};try{body=await res.clone().json();}catch{}
    return {res,body};
  };
  try{
    assert.equal((await request('/')).res.status,200);
    assert.equal((await request('/api/status')).res.status,401);
    assert.equal((await request('/api/login','POST',{password:'wrong'})).res.status,401);
    const login=await request('/api/login','POST',{password:'site-test-password'});
    assert.equal(login.res.status,200);
    cookie=login.res.headers.get('set-cookie').split(';')[0];
    csrf=login.body.csrf;
    assert.equal((await request('/api/jobs','POST',{}, {'x-csrf-token':'wrong'})).res.status,403);
    for(const id of ['first','second']){
      member=id;
      const connect=await request('/api/connect','POST',{});
      assert.equal(connect.res.status,200);
      const state=new URL(connect.body.url).searchParams.get('state');
      const callback=await request('/auth/linkedin/callback?state='+state+'&code=fake');
      assert.equal(callback.res.status,303);
      assert.equal((await request('/auth/linkedin/callback?state='+state+'&code=fake')).res.status,400);
    }
    const status=await request('/api/status');
    assert.equal(status.body.accounts.length,2);
    const scheduled=await request('/api/jobs','POST',{
      accountId:'first',content:'Hello from hosted test',scheduledAt:new Date(Date.now()+60000).toISOString()
    });
    assert.equal(scheduled.res.status,201);
    assert.equal((await request('/internal/run-due','POST',undefined)).res.status,403);
    assert.equal((await request('/internal/run-due','POST',undefined,{'x-scheduler-secret':'wrong'})).res.status,403);
    // Simulate time passing by moving the job's next attempt to the past without a live post.
    store.db.prepare('UPDATE jobs SET scheduled_at=?,next_attempt=?').run(new Date(0).toISOString(),new Date(0).toISOString());
    const results=await app.scheduled({},env);
    assert.equal(results.length,1);
    assert.equal(results[0].status,'published');
    assert.equal(posted,1);
    assert.equal((await app.scheduled({},env)).length,0);
    assert.equal(posted,1);
    const uploadRes=await app.fetch(new Request(origin+'/api/uploads',{
      method:'POST',headers:{origin,cookie,'x-csrf-token':csrf,'x-account-id':'first',
        'x-file-name':'photo.png','content-type':'image/png'},body:PNG
    }),env);
    assert.equal(uploadRes.status,201);
    const {uploadId}=await uploadRes.json();
    assert.equal(media.has(uploadId),true);
    const imageJob=await request('/api/jobs','POST',{
      accountId:'first',content:'Photo post',attachmentId:uploadId,
      scheduledAt:new Date(Date.now()+60000).toISOString()
    });
    assert.equal(imageJob.res.status,201);
    store.db.prepare('UPDATE jobs SET next_attempt=?,scheduled_at=? WHERE id=?')
      .run(new Date(0).toISOString(),new Date(0).toISOString(),imageJob.body.id);
    const imageResults=await app.scheduled({},env);
    assert.equal(imageResults[0].status,'published');
    assert.equal(posted,2);
    assert.equal(media.has(uploadId),false);
    assert.ok(store.getAttachment(uploadId).deleted_at);
    const logout=await request('/api/logout','POST',{});
    assert.equal(logout.res.status,200);
    assert.equal((await request('/api/status')).res.status,401);
  }finally{store.close();}
});
