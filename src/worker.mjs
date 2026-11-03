import { Store } from './store.mjs';
import { decryptToken, publishLinkedInText } from './linkedin.mjs';
import { publishLinkedInMedia,publishLinkedInImages } from './linkedin-media.mjs';
import { readMedia, deleteMedia } from './media.mjs';
import { processDuePosts } from './scheduler.mjs';
export function accountPublisher(store, env, fetchImpl=fetch) {
  return async job => {
    const account=store.getAccount(job.account_id);
    if(!account || Date.parse(account.expires_at)<=Date.now()) { const e=Error('Reconnect');e.status=401;throw e; }
    let token;
    try { token=decryptToken(account.encrypted_token,env.TOKEN_ENCRYPTION_KEY); }
    catch { const e=Error('Token unavailable');e.status=400;throw e; }
    try {
      const attachments=store.attachmentsForJob(job.id);
      if(!attachments.length)return await publishLinkedInText({accessToken:token,personUrn:account.person_urn,text:job.content,
        version:env.LINKEDIN_VERSION||'202610',fetchImpl});
      const dir=env.MEDIA_DIR||'media';
      const options={accessToken:token,personUrn:account.person_urn,text:job.content,
        version:env.LINKEDIN_VERSION||'202610',fetchImpl};
      const loadBytes=async attachment=>readMedia(dir,attachment.id);
      const result=attachments.every(file=>file.kind==='image')
        ?await publishLinkedInImages({...options,attachments,loadBytes})
        :await publishLinkedInMedia({...options,attachment:attachments[0],bytes:await loadBytes(attachments[0])});
      return {...result,cleanup:async()=>{
        for(const attachment of attachments){
          await deleteMedia(dir,attachment.id);
          store.markAttachmentDeleted(attachment.id);
        }
      }};
    } catch(e) {if(e.status===401) store.markAccountExpired(account.id);throw e;}
  };
}
export async function cleanupLocalMedia(store,env) {
  const cutoff=new Date(Date.now()-24*3600000);
  for(const row of store.mediaForCleanup(cutoff)){
    try{await deleteMedia(env.MEDIA_DIR||'media',row.id);store.markAttachmentDeleted(row.id);}
    catch{ /* retry next maintenance cycle */ }
  }
}
export async function runWorker({env=process.env,storage,fetchImpl=fetch,signal,interval=1000}={}) {
  const store=storage ?? new Store(env.DATABASE_PATH || 'scheduler.sqlite');
  let lastCleanup=0;
  try {
    while(!signal?.aborted) {
      try {await processDuePosts({storage:store,publisher:accountPublisher(store,env,fetchImpl),shouldStop:()=>signal?.aborted});
        if(Date.now()-lastCleanup>3600000){await cleanupLocalMedia(store,env);lastCleanup=Date.now();}}
      catch {console.error('Worker storage operation failed');}
      if(signal?.aborted) break;
      await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,interval);signal?.addEventListener('abort',done,{once:true});});
    }
  } finally { if(!storage) store.close(); }
}
