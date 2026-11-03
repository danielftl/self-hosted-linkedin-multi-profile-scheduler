const POSTS='https://api.linkedin.com/rest/posts';
const IMAGES='https://api.linkedin.com/rest/images?action=initializeUpload';
const DOCUMENTS='https://api.linkedin.com/rest/documents?action=initializeUpload';
const VIDEOS='https://api.linkedin.com/rest/videos?action=initializeUpload';
const FINALIZE_VIDEO='https://api.linkedin.com/rest/videos?action=finalizeUpload';
function headers(token,version,extra={}) {
  return {Authorization:'Bearer '+token,'Linkedin-Version':version,
    'X-Restli-Protocol-Version':'2.0.0',...extra};
}
async function api(fetchImpl,url,options) {
  const response=await fetchImpl(url,{...options,signal:AbortSignal.timeout(60000)});
  const raw=await response.text();
  let body={};try{body=raw?JSON.parse(raw):{};}catch{}
  if(!response.ok){
    const error=Error('LinkedIn API HTTP '+response.status);
    error.status=response.status;
    error.retryAfter=Math.max(0,Number(response.headers.get('retry-after'))||0);
    throw error;
  }
  return {body,headers:response.headers};
}
function safeUploadUrl(value) {
  const url=new URL(value);
  const domain=url.hostname;
  if(url.protocol!=='https:'||!(
    domain==='linkedin.com'||domain.endsWith('.linkedin.com')||
    domain==='linkedin-ei.com'||domain.endsWith('.linkedin-ei.com')
  ))throw Error('Unexpected LinkedIn upload destination');
  return url.toString();
}
async function uploadLinkedInMedia({
  accessToken,personUrn,text='',attachment,bytes,version='202610',fetchImpl=fetch
}) {
  if(!accessToken||!/^urn:li:person:[A-Za-z0-9_-]+$/.test(personUrn))throw Error('Invalid account');
  if(!attachment||!['image','document','video'].includes(attachment.kind))throw Error('Unsupported attachment');
  if(!bytes?.length||bytes.length!==attachment.size)throw Error('Missing attachment data');
  if(typeof text!=='string'||text.length>3000)throw Error('Invalid text');
  const isVideo=attachment.kind==='video';
  const url=attachment.kind==='image'?IMAGES:attachment.kind==='document'?DOCUMENTS:VIDEOS;
  const init=await api(fetchImpl,url,{
    method:'POST',headers:headers(accessToken,version,{'Content-Type':'application/json'}),
    body:JSON.stringify({initializeUploadRequest:{
      owner:personUrn,...(isVideo?{fileSizeBytes:bytes.length,uploadCaptions:false,uploadThumbnail:false}:{})
    }})
  });
  const data=init.body.value||{};
  const urn=data[attachment.kind];
  if(typeof urn!=='string'||!urn.startsWith('urn:li:'+attachment.kind+':'))
    throw Error('Invalid LinkedIn upload response');
  if(isVideo){
    const instructions=data.uploadInstructions;
    if(!Array.isArray(instructions)||!instructions.length)throw Error('Invalid video upload instructions');
    let next=0;
    const parts=[];
    for(const instruction of instructions){
      const start=instruction.firstByte,end=Math.min(instruction.lastByte+1,bytes.length);
      if(!Number.isInteger(start)||!Number.isInteger(end)||start!==next||end<=start)
        throw Error('Invalid video part range');
      const part=await api(fetchImpl,safeUploadUrl(instruction.uploadUrl),{
        method:'PUT',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/octet-stream'},
        body:bytes.subarray(start,end)
      });
      const etag=part.headers.get('etag')?.replace(/^"|"$/g,'');
      if(!etag)throw Error('Missing video part ID');
      parts.push(etag);
      next=end;
    }
    if(next!==bytes.length)throw Error('Incomplete video upload');
    await api(fetchImpl,FINALIZE_VIDEO,{
      method:'POST',headers:headers(accessToken,version,{'Content-Type':'application/json'}),
      body:JSON.stringify({finalizeUploadRequest:{
        video:urn,uploadToken:data.uploadToken||'',uploadedPartIds:parts
      }})
    });
  }else{
    if(!data.uploadUrl)throw Error('Missing LinkedIn upload URL');
    await api(fetchImpl,safeUploadUrl(data.uploadUrl),{
      method:'PUT',headers:{Authorization:'Bearer '+accessToken,'Content-Type':attachment.mime},
      body:bytes
    });
  }
  return urn;
}
async function createMediaPost({accessToken,personUrn,text,content,version,fetchImpl}){
  const post={
    author:personUrn,commentary:text,visibility:'PUBLIC',
    distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},
    content,lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false
  };
  const result=await api(fetchImpl,POSTS,{
    method:'POST',headers:headers(accessToken,version,{'Content-Type':'application/json'}),body:JSON.stringify(post)
  });
  const postId=result.headers.get('x-restli-id')??result.body.id;
  if(!postId)throw Error('LinkedIn publication ID missing; outcome uncertain');
  return {postId};
}
export async function publishLinkedInMedia(options){
  const {attachment,version='202610',fetchImpl=fetch}=options;
  const urn=await uploadLinkedInMedia({...options,version,fetchImpl});
  return createMediaPost({...options,version,fetchImpl,content:{media:{id:urn,...(attachment.kind!=='image'?{title:attachment.filename}:{})}}});
}
export async function publishLinkedInImages({attachments,loadBytes,...options}){
  if(!Array.isArray(attachments)||attachments.length<1||attachments.length>20||attachments.some(f=>f.kind!=='image'))throw Error('Select 1–20 images');
  const {version='202610',fetchImpl=fetch}=options;
  const images=[];
  for(const attachment of attachments){
    const bytes=await loadBytes(attachment);
    const id=await uploadLinkedInMedia({...options,attachment,bytes,version,fetchImpl});
    images.push({id});
  }
  const content=images.length===1?{media:images[0]}:{multiImage:{images}};
  return createMediaPost({...options,version,fetchImpl,content});
}
