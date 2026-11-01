import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { processDuePosts } from '../src/scheduler.mjs';
import { accountPublisher } from '../src/worker.mjs';

test('web login, CSRF, multiple profile authorization and scheduled publication', async () => {
  const port = 3181;
  const origin = 'http://127.0.0.1:' + port;
  const key = crypto.randomBytes(32).toString('base64');
  const env = {
    APP_ORIGIN: origin, ADMIN_PASSWORD: 'local-test-only',
    LINKEDIN_CLIENT_ID: 'test-client', LINKEDIN_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: key, DATABASE_PATH: ':memory:'
  };
  let member = 'one';
  const requests = [];
  const mockFetch = async (url, options) => {
    requests.push({url, method:options.method ?? 'GET'});
    if (url.endsWith('/accessToken')) return new Response(JSON.stringify({access_token:'token-'+member,expires_in:3600}),{status:200});
    if (url.endsWith('/userinfo')) return new Response(JSON.stringify({sub:member,name:'Profile '+member}),{status:200});
    if (url.endsWith('/rest/posts')) return new Response('{}',{status:201,headers:{'x-restli-id':'urn:li:share:post1'}});
    throw Error('Unexpected API URL '+url);
  };
  const {server,store} = createApp({env,fetchImpl:mockFetch});
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  let cookie = '', csrf = '';
  const api = async (path,method='GET',data,override={}) => {
    const res = await fetch(origin+path,{
      method,redirect:'manual',
      headers:{cookie, ...(method==='POST'?{origin,'Content-Type':'application/json','x-csrf-token':csrf}:{}),...override},
      body:data===undefined?undefined:JSON.stringify(data)
    });
    const raw=await res.text();
    let json;try{json=JSON.parse(raw);}catch{json={};}
    return {res,json};
  };
  try {
    assert.equal((await api('/api/status')).res.status,401);
    const invalid = await api('/api/login','POST',{password:'wrong'});
    assert.equal(invalid.res.status,401);
    const login=await api('/api/login','POST',{password:'local-test-only'});
    assert.equal(login.res.status,200);
    csrf=login.json.csrf;cookie=login.res.headers.get('set-cookie').split(';')[0];
    assert.ok(csrf);
    assert.equal((await api('/api/jobs','POST',{}, {'x-csrf-token':'bad'})).res.status,403);
    for (const id of ['one','two']) {
      member=id;
      const start=await api('/api/connect','POST',{});
      assert.equal(start.res.status,200);
      const authUrl=new URL(start.json.url);
      assert.equal(authUrl.searchParams.get('client_id'),'test-client');
      const state=authUrl.searchParams.get('state');
      const callback=await api('/auth/linkedin/callback?state='+encodeURIComponent(state)+'&code=fake');
      assert.equal(callback.res.status,303);
      assert.equal((await api('/auth/linkedin/callback?state='+encodeURIComponent(state)+'&code=fake')).res.status,400);
    }
    const status=await api('/api/status');
    assert.equal(status.json.accounts.length,2);
    assert.equal(status.json.accounts[0].status,'Connected');
    const future=new Date(Date.now()+3600000).toISOString();
    const scheduled=await api('/api/jobs','POST',{accountId:'one',content:'Test text',scheduledAt:future});
    assert.equal(scheduled.res.status,201);
    assert.equal((await api('/api/jobs','POST',{accountId:'one',content:'x',scheduledAt:new Date(0).toISOString()})).res.status,400);
    const jobs=(await api('/api/status')).json.jobs;
    assert.equal(jobs.length,1);
    assert.equal(jobs[0].status,'scheduled');
    const outcomes=await processDuePosts({storage:store,publisher:accountPublisher(store,env,mockFetch),now:()=>new Date(Date.now()+7200000)});
    assert.equal(outcomes[0].status,'published');
    assert.equal(store.listJobs()[0].remote_post_id,'urn:li:share:post1');
    assert.equal(requests.filter(x=>x.url.endsWith('/rest/posts')).length,1);
    const logout=await api('/api/logout','POST',{});
    assert.equal(logout.res.status,200);
    assert.equal((await api('/api/status')).res.status,401);
  } finally {
    await new Promise(resolve=>server.close(resolve));store.close();
  }
});
