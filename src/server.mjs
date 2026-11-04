import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Store } from './store.mjs';
import { authorizationUrl, makeOAuthState, exchangeAuthorizationCode, getLinkedInMember, encryptToken } from './linkedin.mjs';
import { processDuePosts } from './scheduler.mjs';
import { accountPublisher } from './worker.mjs';
import { validateUpload,saveMedia,readMedia,deleteMedia,newMediaId,MAX_UPLOAD_BYTES } from './media.mjs';

export function createApp({ env = process.env, storage, fetchImpl = fetch } = {}) {
  const store = storage ?? new Store(env.DATABASE_PATH || 'scheduler.sqlite');
  const origin = env.APP_ORIGIN || 'http://localhost:3000';
  const secure = new URL(origin).protocol === 'https:';
  const password = env.ADMIN_PASSWORD || '';
  const attempts = new Map();
  const configured = Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET && Buffer.from(env.TOKEN_ENCRYPTION_KEY || '', 'base64').length === 32);
  const redirectUri = env.LINKEDIN_REDIRECT_URI || origin+'/auth/linkedin/callback';
  const clientId = env.LINKEDIN_CLIENT_ID || '';
  function cookie(id, age=28800) { return 'session='+id+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+(secure?'; Secure':''); }
  async function body(req) {
    let data=''; for await (const chunk of req) { data+=chunk; if(Buffer.byteLength(data)>16384) throw Error('body'); }
    return JSON.parse(data || '{}');
  }
  const server = http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    function send(status,value) { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(value)); }
    try {
      if (req.headers.host !== new URL(origin).host) return send(403,{error:'Invalid host'});
      const url = new URL(req.url,origin);
      const id = /(?:^|; )session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
      const session = store.getSession(id);
      if (req.method === 'POST' && url.pathname === '/internal/run-due') {
        const secret = env.SCHEDULER_TRIGGER_SECRET || '';
        if (secret.length < 32) return send(404,{error:'Not found'});
        const supplied = req.headers['x-scheduler-secret'];
        if (typeof supplied !== 'string') return send(403,{error:'Forbidden'});
        const hash = value => crypto.createHash('sha256').update(value).digest();
        if (!crypto.timingSafeEqual(hash(supplied),hash(secret))) return send(403,{error:'Forbidden'});
        const results = await processDuePosts({storage:store,publisher:accountPublisher(store,env,fetchImpl),maxJobs:10});
        return send(200,{processed:results.length,results});
      }
      if (req.method === 'GET' && ['/', '/app.js','/style.css','/posting-times.js','/text-format.js','/temporal.js'].includes(url.pathname)) {
        const filename = url.pathname==='/' ? 'index.html' : url.pathname.slice(1);
        res.writeHead(200,{'Content-Type':filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.js')?'text/javascript':'text/css'});
        return res.end(await readFile(new URL('../public/'+filename,import.meta.url)));
      }
      if (req.method==='GET' && url.pathname==='/api/session') return send(200,{authenticated:Boolean(session),csrf:session?.csrf,setup:!password?'Set ADMIN_PASSWORD on the server':null});
      if (req.method!=='GET') {
        if(req.headers.origin!==origin || (url.pathname!=='/api/uploads' && req.headers['content-type']?.split(';')[0]!=='application/json'))
          return send(403,{error:'Invalid request origin'});
      }
      if (req.method==='POST' && url.pathname==='/api/login') {
        if(!password) return send(503,{error:'Set ADMIN_PASSWORD on the server'});
        const key=req.socket.remoteAddress;
        for(const [k,v] of attempts) if(v.until<=Date.now()) attempts.delete(k);
        const rate=attempts.get(key) || {count:0,until:Date.now()+15*60000};
        if(rate.count>=10) return send(429,{error:'Try again later'});
        const input=await body(req);
        const hash = value=>crypto.createHash('sha256').update(value).digest();
        if(typeof input.password!=='string' || !crypto.timingSafeEqual(hash(input.password),hash(password))) {
          rate.count++; attempts.set(key,rate); return send(401,{error:'Incorrect password'});
        }
        store.revokeSession(id);
        const token=makeOAuthState(); const csrf=makeOAuthState();
        try { store.createSession(token,csrf,new Date(Date.now()+8*3600000).toISOString()); }
        catch { return send(503,{error:'Session limit'}); }
        res.setHeader('Set-Cookie',cookie(token)); return send(200,{csrf});
      }
      if(!session) return send(401,{error:'Sign in required'});
      if(req.method!=='GET' && req.headers['x-csrf-token']!==session.csrf) return send(403,{error:'Invalid CSRF token'});
      if(req.method==='POST' && url.pathname==='/api/logout') {store.revokeSession(id);res.setHeader('Set-Cookie',cookie('',0));return send(200,{});}
      if(req.method==='GET' && url.pathname.startsWith('/api/media/')){
        const mediaId=decodeURIComponent(url.pathname.slice('/api/media/'.length));
        const file=store.getAttachment(mediaId);
        if(!file||file.deleted_at||file.kind!=='image'||!['image/png','image/jpeg','image/gif'].includes(file.mime))
          return send(404,{error:'Not found'});
        try{
          const bytes=await readMedia(env.MEDIA_DIR||'media',mediaId);
          res.writeHead(200,{'Content-Type':file.mime,'Cache-Control':'private, no-store'});
          return res.end(bytes);
        }catch{return send(404,{error:'Not found'});}
      }
      if(req.method==='GET' && url.pathname==='/api/posting-times')return send(200,store.postingPreferences());
       if(req.method==='POST' && url.pathname==='/api/posting-times'){
         try{return send(200,store.savePostingPreferences(await body(req)));}catch(e){return send(400,{error:e.message});}
       }
       if(req.method==='POST' && url.pathname==='/api/profile-jobs'){
         if(!configured)return send(503,{error:'LinkedIn setup required'});
         try{return send(201,store.scheduleProfileRows(await body(req)));}catch(e){return send(400,{error:e.message});}
       }
       if(req.method==='POST' && url.pathname==='/api/day-jobs'){
         if(!configured)return send(503,{error:'LinkedIn setup required'});
         try{return send(201,store.scheduleDay(await body(req)));}catch(e){return send(400,{error:e.message});}
       }
       if(req.method==='POST' && url.pathname==='/api/move-job'){
         try{return send(200,store.moveJob(await body(req)));}catch(e){return send(409,{error:e.message});}
       }
       if(req.method==='POST' && url.pathname==='/api/edit-post'){
         if(!configured)return send(503,{error:'LinkedIn setup required'});
         const input=await body(req);
         if(typeof input.id!=='string')return send(400,{error:'Invalid post'});
         try{return send(200,store.updateDraft({...input,schedule:true},'scheduled'));}
         catch(e){return send(409,{error:e.message});}
       }
       if(req.method==='POST' && url.pathname==='/api/draft'){
         const input=await body(req);
         if(typeof input.id!=='string'||(input.schedule!==undefined&&typeof input.schedule!=='boolean'))return send(400,{error:'Invalid draft'});
         if(input.schedule&&!configured)return send(503,{error:'LinkedIn setup required'});
         try{return send(200,store.updateDraft(input));}catch(e){return send(409,{error:e.message});}
       }
       if(req.method==='POST' && url.pathname==='/api/job-action'){
         const input=await body(req);
         if(typeof input.id!=='string'||!['draft','delete'].includes(input.action))return send(400,{error:'Invalid action'});
         try{return send(200,store.changeJobState(input.id,input.action));}catch(e){return send(409,{error:e.message});}
       }
       if(req.method==='GET' && url.pathname==='/api/status') return send(200,{
        setup:configured?null:'Set LINKEDIN_CLIENT_SECRET and a 32-byte base64 TOKEN_ENCRYPTION_KEY on the server',
        accounts:store.listAccounts().map(a=>({...a,status:Date.parse(a.expires_at)<=Date.now()?'Reconnect required':'Connected'})),
        jobs:store.listJobs().map(job=>{
          if(!['draft','scheduled'].includes(job.status))return job;
          const files=store.attachmentsForJob(job.id);
          return {...job,attachments:files.filter(f=>!f.deleted_at).map(({id,filename,mime,kind})=>({id,filename,mime,kind}))};
        })
      });
      if(req.method==='POST' && url.pathname==='/api/connect') {
        if(!configured) return send(503,{error:'LinkedIn setup required'});
        const state=makeOAuthState();
        store.setSessionOAuth(id,state,new Date(Date.now()+600000).toISOString());
        return send(200,{url:authorizationUrl({clientId,redirectUri,state})});
      }
      if(req.method==='GET' && url.pathname==='/auth/linkedin/callback') {
        if(!store.consumeSessionOAuth(id,url.searchParams.get('state'))) return send(400,{error:'Invalid or expired authorization state'});
        if(url.searchParams.has('error')) return send(400,{error:'LinkedIn authorization declined'});
        if(!configured) return send(503,{error:'LinkedIn setup required'});
        try {
          const token=await exchangeAuthorizationCode({clientId,clientSecret:env.LINKEDIN_CLIENT_SECRET,redirectUri,code:url.searchParams.get('code'),fetchImpl});
          if(token.scope && !token.scope.split(/[ ,]+/).includes('w_member_social')) throw Error('scope');
          const member=await getLinkedInMember({accessToken:token.access_token,fetchImpl});
          store.upsertAccount({id:member.id,displayName:member.name || member.id,personUrn:member.personUrn,encryptedToken:encryptToken(token.access_token,env.TOKEN_ENCRYPTION_KEY),expiresAt:new Date(Date.now()+Number(token.expires_in)*1000).toISOString()});
          res.writeHead(303,{Location:'/'});return res.end();
        } catch { return send(502,{error:'LinkedIn connection failed; reconnect'}); }
      }
      if(req.method==='POST' && url.pathname==='/api/uploads') {
        const accountId=req.headers['x-account-id'];
        const account=store.getAccount(accountId);
        if(!configured||!account||Date.parse(account.expires_at)<=Date.now())
          return send(400,{error:'Connect a current LinkedIn profile'});
        let filename;
        try{filename=decodeURIComponent(req.headers['x-file-name']||'');}catch{return send(400,{error:'Invalid filename'});}
        const mime=req.headers['content-type']?.split(';')[0];
        if(!mime)return send(400,{error:'Unsupported file type'});
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>MAX_UPLOAD_BYTES)return send(413,{error:'File too large'});chunks.push(chunk);}
        const bytes=Buffer.concat(chunks);
        let meta;
        try{meta=validateUpload({filename,mime,buffer:bytes});}
        catch(e){return send(400,{error:e.message});}
        const mediaId=newMediaId(),dir=env.MEDIA_DIR||'media';
        try{
          await saveMedia(dir,mediaId,bytes);
          store.saveAttachment({id:mediaId,accountId,...meta});
        }catch{await deleteMedia(dir,mediaId).catch(()=>{});return send(500,{error:'Upload failed'});}
        return send(201,{uploadId:mediaId,filename:meta.filename});
      }
      if(req.method==='POST' && url.pathname==='/api/batch-jobs') {
        const input=await body(req);
        if(!configured)return send(503,{error:'LinkedIn setup required'});
        try{return send(201,{ids:store.scheduleBatch(input)});}
        catch(e){return send(400,{error:e.message});}
      }
      if(req.method==='POST' && url.pathname==='/api/jobs') {
        const input=await body(req); const account=store.getAccount(input.accountId);
        if(!configured || !account || Date.parse(account.expires_at)<=Date.now()) return send(400,{error:'Connect a current LinkedIn profile'});
        if(!Number.isFinite(Date.parse(input.scheduledAt)) || Date.parse(input.scheduledAt)<=Date.now()) return send(400,{error:'Choose a future date and time'});
        try {return send(201,{id:store.schedule(input)});}catch{return send(400,{error:'Invalid post or attachment'});}
      }
      return send(404,{error:'Not found'});
    } catch { if(!res.headersSent) send(400,{error:'Request could not be completed'});else res.end(); }
  });
  return {server,store};
}
