import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';

test('sessions survive separate database connections and OAuth state is single use', () => {
  const folder=mkdtempSync(path.join(tmpdir(),'buffer-session-'));
  const file=path.join(folder,'state.sqlite');
  const first=new Store(file), second=new Store(file);
  try {
    const token=crypto.randomBytes(32).toString('base64url');
    const csrf=crypto.randomBytes(32).toString('base64url');
    first.createSession(token,csrf,new Date(Date.now()+600000).toISOString());
    assert.equal(second.getSession(token).csrf,csrf);
    assert.equal(second.getSession('different-token'),null);
    assert.equal(second.db.prepare('SELECT session_hash FROM sessions').get().session_hash===token,false);
    second.setSessionOAuth(token,'expected-state',new Date(Date.now()+60000).toISOString());
    assert.equal(first.consumeSessionOAuth(token,'wrong-state'),false);
    assert.equal(first.consumeSessionOAuth(token,'expected-state'),true);
    assert.equal(second.consumeSessionOAuth(token,'expected-state'),false);
    first.revokeSession(token);
    assert.equal(second.getSession(token),null);
    const expired=crypto.randomBytes(32).toString('base64url');
    first.createSession(expired,'csrf',new Date(Date.now()+60000).toISOString());
    assert.equal(second.getSession(expired,new Date(Date.now()+120000)),null);
  } finally {first.close();second.close();rmSync(folder,{recursive:true,force:true});}
});

test('login on one server remains valid on another after restart', async () => {
  const folder=mkdtempSync(path.join(tmpdir(),'buffer-web-'));
  const env={DATABASE_PATH:path.join(folder,'state.sqlite'),ADMIN_PASSWORD:'session-test-password'};
  let first,second,store1,store2;
  try {
    const app1=createApp({env:{...env,APP_ORIGIN:'http://127.0.0.1:3184'}});
    first=app1.server;store1=app1.store;
    await new Promise(resolve=>first.listen(3184,'127.0.0.1',resolve));
    const login=await fetch('http://127.0.0.1:3184/api/login',{
      method:'POST',headers:{origin:'http://127.0.0.1:3184','content-type':'application/json'},
      body:JSON.stringify({password:'session-test-password'})
    });
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const csrf=(await login.json()).csrf;
    await new Promise(resolve=>first.close(resolve));store1.close();first=null;store1=null;
    const app2=createApp({env:{...env,APP_ORIGIN:'http://127.0.0.1:3185'}});
    second=app2.server;store2=app2.store;
    await new Promise(resolve=>second.listen(3185,'127.0.0.1',resolve));
    const status=await fetch('http://127.0.0.1:3185/api/session',{headers:{cookie}});
    assert.equal(status.status,200);
    const body=await status.json();
    assert.equal(body.authenticated,true);
    assert.equal(body.csrf,csrf);
    const logout=await fetch('http://127.0.0.1:3185/api/logout',{
      method:'POST',headers:{cookie,origin:'http://127.0.0.1:3185','content-type':'application/json','x-csrf-token':csrf},body:'{}'
    });
    assert.equal(logout.status,200);
    const after=await fetch('http://127.0.0.1:3185/api/session',{headers:{cookie}});
    assert.equal((await after.json()).authenticated,false);
  } finally {
    if(first)await new Promise(resolve=>first.close(resolve));
    if(second)await new Promise(resolve=>second.close(resolve));
    if(store1)store1.close();
    if(store2)store2.close();
    rmSync(folder,{recursive:true,force:true});
  }
});
