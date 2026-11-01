// Web Crypto / Fetch implementation for the hosted Sites runtime.
const encoder=new TextEncoder();
const decoder=new TextDecoder();
const SCOPES='openid profile email w_member_social';
const AUTH='https://www.linkedin.com/oauth/v2/authorization';
const TOKEN='https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO='https://api.linkedin.com/v2/userinfo';
const POSTS='https://api.linkedin.com/rest/posts';
function b64(bytes) {
  let raw='';for(const byte of bytes)raw+=String.fromCharCode(byte);
  return btoa(raw).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function unb64(value) {
  const raw=atob(value.replaceAll('-','+').replaceAll('_','/'));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export function randomState() {
  return b64(crypto.getRandomValues(new Uint8Array(32)));
}
export function oauthUrl({clientId,redirectUri,state}) {
  if(!clientId||!redirectUri||!state)throw Error('Missing OAuth parameters');
  const url=new URL(AUTH);
  url.search=new URLSearchParams({
    response_type:'code',client_id:clientId,redirect_uri:redirectUri,state,scope:SCOPES
  }).toString();
  return url.toString();
}
export async function apiJson(fetchImpl,url,options) {
  const res=await fetchImpl(url,{...options,signal:AbortSignal.timeout(20000)});
  const raw=await res.text();
  let data;try{data=raw?JSON.parse(raw):{};}catch{data={};}
  if(!res.ok){
    const error=Error('LinkedIn API HTTP '+res.status);
    error.status=res.status;
    error.retryAfter=Math.min(3600,Math.max(0,Number(res.headers.get('retry-after'))||0));
    throw error;
  }
  return {data,headers:res.headers,status:res.status};
}
export async function exchangeCode({clientId,clientSecret,redirectUri,code,fetchImpl=fetch}) {
  if(!clientId||!clientSecret||!redirectUri||!code)throw Error('Missing token exchange parameter');
  const body=new URLSearchParams({grant_type:'authorization_code',code,client_id:clientId,
    client_secret:clientSecret,redirect_uri:redirectUri});
  const {data}=await apiJson(fetchImpl,TOKEN,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body
  });
  if(!data.access_token||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<=0)
    throw Error('Invalid token response');
  return data;
}
export async function memberInfo({accessToken,fetchImpl=fetch}) {
  const {data}=await apiJson(fetchImpl,USERINFO,{headers:{Authorization:'Bearer '+accessToken}});
  if(!data.sub || !/^[A-Za-z0-9_-]+$/.test(data.sub))throw Error('Invalid LinkedIn member ID');
  return {id:data.sub,personUrn:'urn:li:person:'+data.sub,name:data.name||data.sub};
}
export async function publishText({accessToken,personUrn,text,version='202610',fetchImpl=fetch}) {
  if(!accessToken||!/^urn:li:person:[A-Za-z0-9_-]+$/.test(personUrn))throw Error('Invalid LinkedIn account');
  if(typeof text!=='string'||!text.trim()||text.length>3000)throw Error('Invalid post');
  const body={
    author:personUrn,commentary:text,visibility:'PUBLIC',
    distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},
    lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false
  };
  const result=await apiJson(fetchImpl,POSTS,{
    method:'POST',headers:{Authorization:'Bearer '+accessToken,
      'Content-Type':'application/json','Linkedin-Version':version,'X-Restli-Protocol-Version':'2.0.0'},
    body:JSON.stringify(body)
  });
  const postId=result.headers.get('x-restli-id')??result.data.id;
  if(!postId)throw Error('LinkedIn publication ID missing; outcome uncertain');
  return {postId};
}
export async function encrypt(plaintext,base64Key) {
  const keyBytes=unb64(base64Key||'');
  if(keyBytes.length!==32)throw Error('Invalid encryption key');
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(plaintext)));
  // Match Node local layout: IV (12), authentication tag (16), ciphertext.
  const output=new Uint8Array(28+encrypted.length-16);
  output.set(iv,0);
  output.set(encrypted.slice(-16),12);
  output.set(encrypted.slice(0,-16),28);
  return b64(output);
}
export async function decrypt(encryptedToken,base64Key) {
  const keyBytes=unb64(base64Key||'');
  if(keyBytes.length!==32)throw Error('Invalid encryption key');
  const bytes=unb64(encryptedToken);
  if(bytes.length<29)throw Error('Invalid encrypted token');
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt']);
  const combined=new Uint8Array(bytes.length-28+16);
  combined.set(bytes.slice(28),0);
  combined.set(bytes.slice(12,28),bytes.length-28);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},key,combined);
  return decoder.decode(plain);
}
export async function sameSecret(left,right) {
  if(typeof left!=='string'||typeof right!=='string')return false;
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(left)),crypto.subtle.digest('SHA-256',encoder.encode(right))]);
  let diff=0;const x=new Uint8Array(a),y=new Uint8Array(b);
  for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
}
