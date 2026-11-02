import {toggleStyle,toggleBullets,clipboardText} from './text-format.js';
import {defaultPreferences,localParts,profileTime,zonedInstant,resolveDay} from './posting-times.js';
const $=id=>document.getElementById(id);
let csrf='',accounts=[],jobs=[],view='calendar',month=new Date();
const selected=new Set();
let postingPreferences=defaultPreferences(),draggedJob=null,editingPreferences=null;
let editingDraft=null,previousSelection=[];
const show=(message,error=false)=>{$('message').textContent=message||'';$('message').classList.toggle('error',error);};
async function api(path,method='GET',data){
  const response=await fetch(path,{method,credentials:'same-origin',
    headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},
    body:data===undefined?undefined:JSON.stringify(data)});
  let result={};try{result=await response.json();}catch{result={error:'Request failed'};}
  if(!response.ok)throw Error(result.error||'Request failed');
  return result;
}
function cell(text){const td=document.createElement('td');td.textContent=String(text??'');return td;}
function connected(){return accounts.filter(a=>a.status==='Connected');}
function initials(name){return name.split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();}
function avatar(account){const span=document.createElement('span');span.className='avatar';span.textContent=initials(account.display_name);return span;}
function setLoggedIn(yes){
  $('login-panel').hidden=yes;$('workspace').hidden=!yes;$('logout').hidden=!yes;
  $('posting-times').hidden=!yes;$('new-post').disabled=!yes;$('header-new-post').disabled=!yes;
}
function formatDate(iso){return new Date(iso).toLocaleString(undefined,{timeZone:postingPreferences.timeZone});}
function calendarDay(date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
function refreshProfiles(){
  const root=$('accounts');root.replaceChildren();
  const profiles=connected();
  for(const account of accounts){
    const label=document.createElement('label');label.className='profile-row';
    const check=document.createElement('input');check.type='checkbox';check.value=account.id;
    check.checked=selected.has(account.id);check.disabled=Boolean(editingDraft)||account.status!=='Connected';
    check.addEventListener('change',()=>{check.checked?selected.add(account.id):selected.delete(account.id);refreshProfiles();refreshComposerProfiles();});
    const name=document.createElement('strong');name.textContent=account.display_name;
    const status=document.createElement('span');status.className='profile-status';status.textContent=account.status;
    label.append(check,avatar(account),name,status);root.append(label);
  }
  if(!accounts.length){const p=document.createElement('p');p.textContent='No profiles connected';root.append(p);}
  if(profiles.length){
    const all=document.createElement('button');all.className='select-all';all.type='button';all.disabled=Boolean(editingDraft);
    all.textContent=profiles.every(a=>selected.has(a.id))?'Deselect all':'Select all';
    all.addEventListener('click',()=>{
      const every=profiles.every(a=>selected.has(a.id));
      for(const account of profiles){every?selected.delete(account.id):selected.add(account.id);}
      refreshProfiles();refreshComposerProfiles();
    });
    root.append(all);
  }
}
function refreshComposerProfiles(){
  const root=$('selected-profiles');root.replaceChildren();
  const profiles=connected();
  for(const account of profiles){
    const label=document.createElement('label');label.className='composer-profile';
    const input=document.createElement('input');input.type='checkbox';input.value=account.id;
    input.checked=selected.has(account.id);input.disabled=Boolean(editingDraft);
    input.addEventListener('change',()=>{
      input.checked?selected.add(account.id):selected.delete(account.id);
      refreshProfiles();refreshComposerProfiles();
    });
    const name=document.createElement('span');name.textContent=account.display_name;
    if($('use-profile-times').checked&&$('date').value){
      const time=profileTime(postingPreferences,account.id,$('date').value.slice(0,10));
      name.textContent+=' · '+(time===null?'Skip':time);
    }
    label.append(input,avatar(account),name);root.append(label);
  }
  $('selected-count').textContent=selected.size+' profiles selected';
  $('preview-profile').textContent=profiles.filter(a=>selected.has(a.id)).map(a=>a.display_name).join(', ')||'LinkedIn';
}
function openPost(job){
  $('post-profile').textContent=accounts.find(a=>a.id===job.account_id)?.display_name||job.account_id;
  $('post-time').textContent=job.status==='draft'?'—':formatDate(job.scheduled_at);
  $('post-status').textContent=job.status;
  $('post-text').textContent=job.content||'';
  $('post-attachment').textContent=job.attachment_name||'';
  $('post-dialog').showModal();
}
function postActions(job){
  const actions=document.createElement('div');actions.className='post-actions';
  for(const [action,label] of [['view','View post'],['edit','Edit'],['draft','Shift to draft'],['delete','Delete']]){
    if(action==='edit'&&job.status!=='draft')continue;
    if((job.status==='publishing'&&action!=='view')||(action==='draft'&&!['scheduled','failed','uncertain'].includes(job.status)))continue;
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;
    button.addEventListener('click',async e=>{
      e.stopPropagation();if(action==='view'){openPost(job);return;}if(action==='edit'){openComposer(job);return;}button.disabled=true;
      try{await api('/api/job-action','POST',{id:job.id,action});await refresh();}
      catch(error){show(error.message,true);button.disabled=false;}
    });
    actions.append(button);
  }
  return actions;
}
function renderList(){
  const tbody=$('jobs');tbody.replaceChildren();
  for(const job of jobs){
    const row=document.createElement('tr');
    const profile=accounts.find(a=>a.id===job.account_id)?.display_name||job.account_id;
    const text=job.content;
    row.append(cell(profile),cell([text,job.attachment_name].filter(Boolean).join(' | ')),
      cell(job.status==='draft'?'—':formatDate(job.scheduled_at)),cell(job.status));
    const actions=document.createElement('td');actions.append(postActions(job));row.append(actions);
    tbody.append(row);
  }
  if(!jobs.length){const row=document.createElement('tr'),td=cell('No posts scheduled');td.colSpan=5;row.append(td);tbody.append(row);}
}
function renderCalendar(){
  const first=new Date(month.getFullYear(),month.getMonth(),1);
  $('month-label').textContent=first.toLocaleString(undefined,{month:'long',year:'numeric'});
  $('calendar-timezone').textContent=postingPreferences.timeZone;
  const start=new Date(first);start.setDate(1-(first.getDay()+6)%7);
  const root=$('calendar');root.replaceChildren();
  for(const day of ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']){
    const label=document.createElement('div');label.className='weekday';label.textContent=day;root.append(label);
  }
  for(let i=0;i<42;i++){
    const date=new Date(start);date.setDate(start.getDate()+i);
    const tile=document.createElement('div');tile.className='day';
    tile.tabIndex=0;tile.setAttribute('role','button');
    tile.setAttribute('aria-label','Create post on '+date.toLocaleDateString());
    const selectDate=e=>{
      if(e.target.closest?.('.calendar-post'))return;
      openComposer();
      const time=$('date').value.slice(11)||'10:00';
      const localDay=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      $('date').value=localDay+'T'+time;refreshComposerProfiles();
    };
    const targetDay=calendarDay(date);
    tile.addEventListener('dragover',e=>{if(draggedJob){e.preventDefault();e.dataTransfer.dropEffect='move';}});
    tile.addEventListener('drop',async e=>{
      if(!draggedJob)return;e.preventDefault();e.stopPropagation();const id=draggedJob;draggedJob=null;
      try{await api('/api/move-job','POST',{id,day:targetDay});await refresh();}catch(error){show(error.message,true);}
    });
    tile.addEventListener('click',selectDate);
    tile.addEventListener('keydown',e=>{
      if(e.target.closest?.('.calendar-post'))return;
      if(e.key==='Enter'||e.key===' '){e.preventDefault();selectDate(e);}
    });
    if(date.getMonth()!==first.getMonth())tile.classList.add('outside');
    if(calendarDay(date)===localParts(Date.now(),postingPreferences.timeZone).day)tile.classList.add('today');
    const number=document.createElement('span');number.className='day-number';number.textContent=date.getDate();tile.append(number);
    const dayJobs=jobs.filter(j=>j.status!=='draft'&&localParts(j.scheduled_at,postingPreferences.timeZone).day===calendarDay(date));
    for(const job of dayJobs){
      const item=document.createElement('div');item.className='calendar-post';
      const name=accounts.find(a=>a.id===job.account_id)?.display_name||job.account_id;
      item.draggable=job.status==='scheduled';
      item.addEventListener('dragstart',e=>{if(!item.draggable||e.target.closest('button')){e.preventDefault();return;}draggedJob=job.id;e.dataTransfer.setData('text/plain',job.id);e.dataTransfer.effectAllowed='move';});
      item.addEventListener('dragend',()=>{draggedJob=null;});
      item.textContent=new Date(job.scheduled_at).toLocaleTimeString([],{timeZone:postingPreferences.timeZone,hour:'numeric',minute:'2-digit'})+' · '+name;
      item.title=(job.content||job.attachment_name||'Post')+' — '+job.status;
      item.append(postActions(job));
      tile.append(item);
    }
    root.append(tile);
  }
}
function setView(next){
  view=next;$('calendar-section').hidden=next!=='calendar';$('list-section').hidden=next!=='list';
  for(const [id,active] of [['calendar-view',next==='calendar'],['list-view',next==='list']]){
    $(id).classList.toggle('active',active);
  }
  if(next==='calendar')renderCalendar();else renderList();
}
async function refresh(){
  const status=await api('/api/status');
  $('setup').hidden=!status.setup;$('setup').textContent=status.setup||'';
  $('connect').disabled=Boolean(status.setup);
  accounts=status.accounts;jobs=status.jobs;
  for(const id of [...selected])if(!connected().some(a=>a.id===id))selected.delete(id);
  refreshProfiles();refreshComposerProfiles();renderList();renderCalendar();
}
function openComposer(draft=null){
  if($('workspace').hidden)return;
  if(!draft)$('use-profile-times').checked=true;
  if(draft){
    $('use-profile-times').checked=false;
    editingDraft=draft;previousSelection=[...selected];selected.clear();selected.add(draft.account_id);
    $('content').value=draft.content;$('attachment').value='';
    const date=new Date(draft.scheduled_at);
    $('date').value=date.getTime()>Date.now()?localParts(date,postingPreferences.timeZone).day+'T'+localParts(date,postingPreferences.timeZone).time:'';
  }
  $('save-draft').hidden=!editingDraft;$('composer-title').textContent=editingDraft?'Edit draft':'Create Post';
  $('composer-overlay').hidden=false;refreshProfiles();refreshComposerProfiles();updatePreview();
  $('content').focus();
}
function closeComposer(){
  $('composer-overlay').hidden=true;
  if(editingDraft){
    editingDraft=null;selected.clear();for(const id of previousSelection)selected.add(id);
    $('content').value='';$('attachment').value='';$('date').value='';refreshProfiles();refreshComposerProfiles();updatePreview();
  }
}
function updatePreview(){
  $('preview-text').textContent=$('content').value;
  $('count').textContent=$('content').value.length+' / 3000';
  const file=$('attachment').files[0];
  const filename=file?.name||editingDraft?.attachment_name||'';
  $('preview-attachment').hidden=!filename;
  $('preview-attachment').textContent=filename;
}
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();
  try{const result=await api('/api/login','POST',{password:$('password').value});
    csrf=result.csrf;$('password').value='';setLoggedIn(true);
    postingPreferences=await api('/api/posting-times');await refresh();setView('calendar');show('');
  }catch(error){show(error.message,true);}
});
$('logout').addEventListener('click',async()=>{
  try{await api('/api/logout','POST',{});csrf='';setLoggedIn(false);closeComposer();show('');}
  catch(error){show(error.message,true);}
});
$('connect').addEventListener('click',async()=>{
  try{const result=await api('/api/connect','POST',{});location.assign(result.url);}
  catch(error){show(error.message,true);}
});
for(const id of ['new-post','header-new-post'])$(id).addEventListener('click',()=>openComposer());
$('close-composer').addEventListener('click',closeComposer);
$('composer-overlay').addEventListener('click',e=>{if(e.target===$('composer-overlay'))closeComposer();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeComposer();});
for(const id of ['calendar-view','nav-publish'])$(id).addEventListener('click',()=>setView('calendar'));
$('list-view').addEventListener('click',()=>setView('list'));
$('prev-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);renderCalendar();});
$('next-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);renderCalendar();});
$('today').addEventListener('click',()=>{const d=localParts(Date.now(),postingPreferences.timeZone).day.split('-').map(Number);month=new Date(d[0],d[1]-1,1);renderCalendar();});
$('content').addEventListener('input',updatePreview);
$('attachment').addEventListener('change',updatePreview);
async function uploadAttachments(accountIds,file){
  const attachmentIds={};
    if(file){
      const mime=file.type||({
        doc:'application/msword',ppt:'application/vnd.ms-powerpoint',
        docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      }[file.name.split('.').pop().toLowerCase()]);
      if(!mime)throw Error('Unsupported attachment');
      for(const accountId of accountIds){
        const response=await fetch('/api/uploads',{method:'POST',credentials:'same-origin',
          headers:{'Content-Type':mime,'x-file-name':encodeURIComponent(file.name),
            'x-account-id':accountId,'x-csrf-token':csrf},body:file});
        const result=await response.json();
        if(!response.ok)throw Error(result.error||'Upload failed');
        attachmentIds[accountId]=result.uploadId;
      }
    }
  return attachmentIds;
}
$('save-draft').addEventListener('click',async()=>{
  if(!editingDraft)return;
  const button=$('save-draft');button.disabled=true;$('schedule').disabled=true;
  try{
    const draft=editingDraft;
    const attachmentIds=await uploadAttachments([draft.account_id],$('attachment').files[0]);
    await api('/api/draft','POST',{id:draft.id,content:$('content').value,attachmentId:attachmentIds[draft.account_id]});
    closeComposer();await refresh();setView('list');
  }catch(error){show(error.message,true);}finally{button.disabled=false;$('schedule').disabled=false;}
});
$('schedule-form').addEventListener('submit',async e=>{
  e.preventDefault();show('');
  const button=$('schedule');button.disabled=true;$('save-draft').disabled=true;
  try{
    let accountIds=[...selected];
    if(!accountIds.length)throw Error('Select at least one LinkedIn profile');
    const day=$('date').value.slice(0,10),useDefaults=$('use-profile-times').checked;
    let scheduledTimes={};
    if(useDefaults){const plan=resolveDay(postingPreferences,accountIds,day);accountIds=plan.accountIds;scheduledTimes=plan.scheduledTimes;}
    const date=new Date(useDefaults?scheduledTimes[accountIds[0]]:zonedInstant(day,$('date').value.slice(11,16),postingPreferences.timeZone));
    if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())throw Error('Choose a future date and time');
    const file=$('attachment').files[0];
    const content=$('content').value;
    if(!content.trim()&&!file&&!editingDraft?.attachment_name)throw Error('Enter a post or select an attachment');
    const attachmentIds=await uploadAttachments(accountIds,file);
    if(editingDraft)await api('/api/draft','POST',{id:editingDraft.id,content,scheduledAt:date.toISOString(),schedule:true,attachmentId:attachmentIds[editingDraft.account_id]});
    else if(useDefaults)await api('/api/day-jobs','POST',{accountIds,content,day,attachmentIds});
    else await api('/api/batch-jobs','POST',{accountIds,content,scheduledAt:date.toISOString(),attachmentIds});
    $('content').value='';$('attachment').value='';updatePreview();
    await refresh();closeComposer();show('Post scheduled for '+accountIds.length+' profiles');
    const shown=localParts(date,postingPreferences.timeZone).day.split('-').map(Number);month=new Date(shown[0],shown[1]-1,1);setView('calendar');
  }catch(error){show(error.message,true);}finally{button.disabled=false;$('save-draft').disabled=false;}
});
async function init(){
  try{const session=await api('/api/session');csrf=session.csrf||'';
    setLoggedIn(session.authenticated);
    if(session.authenticated){
      postingPreferences=await api('/api/posting-times');
      const today=localParts(Date.now(),postingPreferences.timeZone).day.split('-').map(Number);month=new Date(today[0],today[1]-1,1);
      await refresh();
    }else if(session.setup)show(session.setup,true);
    setView('calendar');
  }catch(error){show(error.message,true);}
}
init();
setInterval(()=>{if(!$('workspace').hidden)refresh().catch(e=>show(e.message,true));},30000);


$('date').addEventListener('input',refreshComposerProfiles);
$('use-profile-times').addEventListener('change',refreshComposerProfiles);
function drawPostingWeek(){
 const id=$('posting-profile').value,root=$('posting-week');root.replaceChildren();
 if(!id)return;
 if(!editingPreferences.profiles[id])editingPreferences.profiles[id]=Object.fromEntries(Array.from({length:7},(_,day)=>[day,'10:00']));
 for(const [day,name] of [[1,'Monday'],[2,'Tuesday'],[3,'Wednesday'],[4,'Thursday'],[5,'Friday'],[6,'Saturday'],[0,'Sunday']]){
  const row=document.createElement('label');row.className='posting-day';const on=document.createElement('input');on.type='checkbox';on.checked=editingPreferences.profiles[id][day]!==null;
  const text=document.createElement('span');text.textContent=name;const time=document.createElement('input');time.type='time';time.value=editingPreferences.profiles[id][day]||'10:00';time.disabled=!on.checked;
  on.addEventListener('change',()=>{time.disabled=!on.checked;editingPreferences.profiles[id][day]=on.checked?time.value:null;});
  time.addEventListener('input',()=>{editingPreferences.profiles[id][day]=time.value;});row.append(on,text,time);root.append(row);
 }
}
function searchTimeZones(){
  const zones=$('posting-zone'),current=zones.value||editingPreferences.timeZone;
  const query=$('zone-city').value.trim().toLocaleLowerCase().replaceAll('_',' ');
  const matches=[...new Set(['Asia/Singapore',editingPreferences.timeZone,...Intl.supportedValuesOf('timeZone')])].filter(zone=>zone.toLocaleLowerCase().replaceAll('_',' ').includes(query));
  zones.replaceChildren();
  for(const zone of matches){const option=document.createElement('option');option.value=zone;option.textContent=zone.replaceAll('_',' ');zones.append(option);}
  if(!matches.length){const option=document.createElement('option');option.value='';option.textContent='No matching time zone';zones.append(option);}
  else zones.value=matches.includes(current)?current:matches[0];
}
$('zone-search').addEventListener('click',searchTimeZones);
$('zone-city').addEventListener('input',searchTimeZones);
$('zone-city').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchTimeZones();}});
$('posting-times').addEventListener('click',async()=>{
 try{
  editingPreferences=await api('/api/posting-times');$('posting-zone').replaceChildren();$('zone-city').value='';searchTimeZones();const profiles=$('posting-profile');profiles.replaceChildren();
  for(const account of accounts){const option=document.createElement('option');option.value=account.id;option.textContent=account.display_name;profiles.append(option);}
  drawPostingWeek();$('posting-dialog').showModal();
 }catch(error){show(error.message,true);}
});
$('posting-profile').addEventListener('change',drawPostingWeek);
$('posting-close').addEventListener('click',()=>$('posting-dialog').close());
$('posting-form').addEventListener('submit',async e=>{
 e.preventDefault();try{editingPreferences.timeZone=$('posting-zone').value;postingPreferences=await api('/api/posting-times','POST',editingPreferences);$('posting-dialog').close();renderList();renderCalendar();refreshComposerProfiles();}catch(error){show(error.message,true);}
});

function applyTextFormat(style){
 const input=$('content');let start=input.selectionStart,end=input.selectionEnd;
 if(style==='bullets'){
  start=input.value.lastIndexOf('\n',start-1)+1;
  const next=input.value.indexOf('\n',end);end=next<0?input.value.length:next;
 }
 const text=input.value.slice(start,end);
 if(!text){input.focus();return;}
 const replacement=style==='bullets'?toggleBullets(text):toggleStyle(text,style);
 if(input.value.length-text.length+replacement.length>3000){input.focus();return;}
 input.setRangeText(replacement,start,end,'select');input.focus();updatePreview();
}
for(const style of ['bold','italic','bullets']){
 $('format-'+style).addEventListener('mousedown',e=>e.preventDefault());
 $('format-'+style).addEventListener('click',()=>applyTextFormat(style));
}
$('content').addEventListener('keydown',e=>{
 if((e.ctrlKey||e.metaKey)&&['b','i'].includes(e.key.toLowerCase())){e.preventDefault();applyTextFormat(e.key.toLowerCase()==='b'?'bold':'italic');}
});
$('content').addEventListener('paste',e=>{
 const html=e.clipboardData?.getData('text/html');
 if(!html||!/(<(?:b|strong|i|em)(?:\s|>)|font-weight|font-style)/i.test(html))return;
 const template=document.createElement('template');template.innerHTML=html;
 const text=clipboardText(template.content),input=$('content');
 const room=3000-(input.value.length-(input.selectionEnd-input.selectionStart));
 let clipped='';for(const char of text){if(clipped.length+char.length>room)break;clipped+=char;}
 e.preventDefault();input.setRangeText(clipped,input.selectionStart,input.selectionEnd,'end');updatePreview();
});

$('post-close').addEventListener('click',()=>$('post-dialog').close());
