// ChatGPT Sites / Cloudflare-compatible handler. UI assets remain unchanged in public/.
import { D1Store } from './d1-store.mjs';
import { randomState, oauthUrl, exchangeCode, memberInfo, publishText, encrypt, decrypt, sameSecret } from './linkedin-web.mjs';
import { processDuePosts } from './scheduler.mjs';
import { publishLinkedInMedia } from './linkedin-media.mjs';
import { validateUpload,MAX_UPLOAD_BYTES,newMediaId } from './media-validation.mjs';

function response(status,data,headers={}) {
  return new Response(JSON.stringify(data),{status,headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    ...headers
  }});
}
function cookie(token,secure,maxAge=28800) {
  return 'session='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':'');
}
async function jsonBody(request) {
  if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw Error('Invalid content type');
  const raw=await request.text();
  if(raw.length>16384)throw Error('Request too large');
  return JSON.parse(raw||'{}');
}
async function runDue(store,env,fetchImpl) {
  const publisher=async job=>{
    const account=await store.getAccount(job.account_id);
    if(!account||Date.parse(account.expires_at)<=Date.now()){
      const e=Error('Reconnect account');e.status=401;throw e;
    }
    let token;
    try{token=await decrypt(account.encrypted_token,env.TOKEN_ENCRYPTION_KEY);}
    catch{const e=Error('Token unavailable');e.status=400;throw e;}
    try{
      const attachment=await store.attachmentForJob(job.id);
      if(!attachment)return await publishText({accessToken:token,personUrn:account.person_urn,text:job.content,
        version:env.LINKEDIN_VERSION||'202610',fetchImpl});
      if(!env.MEDIA?.get)throw Error('Media storage unavailable');
      const object=await env.MEDIA.get(attachment.id);
      if(!object)throw Error('Attachment missing');
      const bytes=new Uint8Array(await object.arrayBuffer());
      const result=await publishLinkedInMedia({accessToken:token,personUrn:account.person_urn,
        text:job.content,attachment,bytes,version:env.LINKEDIN_VERSION||'202610',fetchImpl});
      return {...result,cleanup:async()=>{
        await env.MEDIA.delete(attachment.id);
        await store.markAttachmentDeleted(attachment.id);
      }};
    }catch(e){if(e.status===401)await store.markAccountExpired(account.id);throw e;}
  };
  const outcomes=await processDuePosts({storage:store,publisher,maxJobs:10});
  if(env.MEDIA?.delete && store.mediaForCleanup){
    const expired=await store.mediaForCleanup(new Date(Date.now()-24*3600000));
    for(const file of expired){
      try{await env.MEDIA.delete(file.id);await store.markAttachmentDeleted(file.id);}
      catch{ /* retry on next scheduled invocation */ }
    }
  }
  return outcomes;
}
export function createSiteHandler({storage,fetchImpl=fetch}={}) {
  return {
    async fetch(request,env) {
      const url=new URL(request.url);
      const origin=env.APP_ORIGIN||url.origin;
      let expected;
      try{expected=new URL(origin);}catch{return response(503,{error:'Server configuration missing'});}
      if(url.host!==expected.host||url.protocol!==expected.protocol)
        return response(403,{error:'Invalid host'});
      const store=storage??new D1Store(env.DB);
      const secure=expected.protocol==='https:';
      const password=env.ADMIN_PASSWORD||'';
      const configured=Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY);
      const clientId=env.LINKEDIN_CLIENT_ID||'';
      const redirectUri=env.LINKEDIN_REDIRECT_URI||origin+'/auth/linkedin/callback';
      const id=/(?:^|;\s*)session=([A-Za-z0-9_-]+)/.exec(request.headers.get('cookie')||'')?.[1];
      try{
        if(request.method==='POST'&&url.pathname==='/internal/run-due'){
          const secret=env.SCHEDULER_TRIGGER_SECRET||'';
          if(secret.length<32)return response(404,{error:'Not found'});
          if(!await sameSecret(request.headers.get('x-scheduler-secret'),secret))
            return response(403,{error:'Forbidden'});
          const results=await runDue(store,env,fetchImpl);
          return response(200,{processed:results.length,results});
        }
        if(request.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){
          if(!env.ASSETS?.fetch)return response(503,{error:'Site assets unavailable'});
          return env.ASSETS.fetch(request);
        }
        const session=await store.getSession(id);
        if(request.method==='GET'&&url.pathname==='/api/session')
          return response(200,{authenticated:Boolean(session),csrf:session?.csrf,setup:!password?'Set ADMIN_PASSWORD on the server':null});
        if(request.method!=='GET'&&request.headers.get('Origin')!==origin)
          return response(403,{error:'Invalid request origin'});
        if(request.method==='POST'&&url.pathname==='/api/login'){
          if(!password)return response(503,{error:'Set ADMIN_PASSWORD on the server'});
          const input=await jsonBody(request);
          const key=(request.headers.get('CF-Connecting-IP')||'unknown').slice(0,80);
          if(await store.loginBlocked?.(key))return response(429,{error:'Try again later'});
          if(typeof input.password!=='string'||!await sameSecret(input.password,password)){
            await store.recordLoginFailure?.(key);
            return response(401,{error:'Incorrect password'});
          }
          await store.clearLoginFailures?.(key);
          await store.revokeSession(id);
          const token=randomState(),csrf=randomState();
          try{await store.createSession(token,csrf,new Date(Date.now()+28800000).toISOString());}
          catch{return response(503,{error:'Session limit'});}
          return response(200,{csrf},{'Set-Cookie':cookie(token,secure)});
        }
        if(!session)return response(401,{error:'Sign in required'});
        if(request.method!=='GET'&&request.headers.get('x-csrf-token')!==session.csrf)
          return response(403,{error:'Invalid CSRF token'});
        if(request.method==='POST'&&url.pathname==='/api/logout'){
          await store.revokeSession(id);
          return response(200,{}, {'Set-Cookie':cookie('',secure,0)});
        }
        if(request.method==='GET'&&url.pathname==='/api/status'){
          const accounts=await store.listAccounts();
          const jobs=await store.listJobs();
          return response(200,{
            setup:configured?null:'Set LINKEDIN_CLIENT_SECRET and a 32-byte base64 TOKEN_ENCRYPTION_KEY on the server',
            accounts:accounts.map(a=>({...a,status:Date.parse(a.expires_at)<=Date.now()?'Reconnect required':'Connected'})),
            jobs
          });
        }
        if(request.method==='POST'&&url.pathname==='/api/connect'){
          await jsonBody(request);
          if(!configured)return response(503,{error:'LinkedIn setup required'});
          const state=randomState();
          await store.setSessionOAuth(id,state,new Date(Date.now()+600000).toISOString());
          return response(200,{url:oauthUrl({clientId,redirectUri,state})});
        }
        if(request.method==='GET'&&url.pathname==='/auth/linkedin/callback'){
          if(!await store.consumeSessionOAuth(id,url.searchParams.get('state')))
            return response(400,{error:'Invalid or expired authorization state'});
          if(url.searchParams.has('error'))return response(400,{error:'LinkedIn authorization declined'});
          if(!configured)return response(503,{error:'LinkedIn setup required'});
          try{
            const token=await exchangeCode({
              clientId,clientSecret:env.LINKEDIN_CLIENT_SECRET,redirectUri,
              code:url.searchParams.get('code'),fetchImpl
            });
            if(token.scope&&!token.scope.split(/[ ,]+/).includes('w_member_social'))throw Error('Missing posting permission');
            const member=await memberInfo({accessToken:token.access_token,fetchImpl});
            await store.upsertAccount({
              id:member.id,displayName:member.name,personUrn:member.personUrn,
              encryptedToken:await encrypt(token.access_token,env.TOKEN_ENCRYPTION_KEY),
              expiresAt:new Date(Date.now()+Number(token.expires_in)*1000).toISOString()
            });
            return new Response(null,{status:303,headers:{Location:'/', 'Cache-Control':'no-store'}});
          }catch{return response(502,{error:'LinkedIn connection failed; reconnect'});}
        }
        if(request.method==='POST'&&url.pathname==='/api/uploads'){
          if(!env.MEDIA?.put)return response(503,{error:'Media storage unavailable'});
          const accountId=request.headers.get('x-account-id');
          const account=await store.getAccount(accountId);
          if(!configured||!account||Date.parse(account.expires_at)<=Date.now())
            return response(400,{error:'Connect a current LinkedIn profile'});
          const length=Number(request.headers.get('content-length')||0);
          if(length>MAX_UPLOAD_BYTES)return response(413,{error:'File too large'});
          let filename;
          try{filename=decodeURIComponent(request.headers.get('x-file-name')||'');}
          catch{return response(400,{error:'Invalid filename'});}
          const mime=request.headers.get('content-type')?.split(';')[0];
          const bytes=new Uint8Array(await request.arrayBuffer());
          if(bytes.length>MAX_UPLOAD_BYTES)return response(413,{error:'File too large'});
          let meta;
          try{meta=validateUpload({filename,mime,buffer:bytes});}
          catch(e){return response(400,{error:e.message});}
          const id=newMediaId();
          try{
            await env.MEDIA.put(id,bytes,{httpMetadata:{contentType:mime}});
            await store.saveAttachment({id,accountId,...meta});
          }catch{
            await env.MEDIA.delete(id).catch(()=>{});
            return response(500,{error:'Upload failed'});
          }
          return response(201,{uploadId:id,filename:meta.filename});
        }
        if(request.method==='POST'&&url.pathname==='/api/batch-jobs'){
          if(!configured)return response(503,{error:'LinkedIn setup required'});
          const input=await jsonBody(request);
          try{return response(201,{ids:await store.scheduleBatch(input)});}
          catch(e){return response(400,{error:e.message});}
        }
        if(request.method==='POST'&&url.pathname==='/api/jobs'){
          const input=await jsonBody(request);
          const account=await store.getAccount(input.accountId);
          if(!configured||!account||Date.parse(account.expires_at)<=Date.now())
            return response(400,{error:'Connect a current LinkedIn profile'});
          if(!Number.isFinite(Date.parse(input.scheduledAt))||Date.parse(input.scheduledAt)<=Date.now())
            return response(400,{error:'Choose a future date and time'});
          try{return response(201,{id:await store.schedule(input)});}
          catch{return response(400,{error:'Invalid post; text must be 1–3000 characters'});}
        }
        return response(404,{error:'Not found'});
      }catch{
        return response(400,{error:'Request could not be completed'});
      }
    },
    async scheduled(_controller,env) {
      const store=storage??new D1Store(env.DB);
      return runDue(store,env,fetchImpl);
    }
  };
}
export default createSiteHandler();
