import {toggleStyle,toggleBullets,clipboardText} from './text-format.js';
import {DEFAULT_ZONE,defaultPreferences,localParts,profileTime,profileZone,resolveProfileRows,scheduleFeedback} from './posting-times.js';
const $=id=>document.getElementById(id);
let scheduleBusy=false;
let csrf='',accounts=[],jobs=[],view='calendar',month=new Date(),listFilter='scheduled';
const selected=new Set();
let postingPreferences=defaultPreferences(),draggedJob=null,editingPreferences=null;
let editingDraft=null,previousSelection=[],previewImageUrls=[],composerDay=null,editingZoneProfile=null;
const profileSchedules=new Map();
const show=(message,error=false)=>{$('message').textContent=message||'';$('message').classList.toggle('error',error);};
async function api(path,method='GET',data){
  const response=await fetch(path,{method,credentials:'same-origin',
    headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},
    body:data===undefined?undefined:JSON.stringify(data)});
  let result={};try{result=await response.json();}catch{result={error:'Request failed'};}
  if(!response.ok)throw Error(result.error||'Request failed');
  return result;
}
function setLoggedIn(yes){
  $('login-panel').hidden=yes;$('workspace').hidden=!yes;$('logout').hidden=!yes;
  $('posting-times').hidden=!yes;$('new-post').disabled=!yes;$('header-new-post').disabled=!yes;
}
function cell(text){const td=document.createElement('td');td.textContent=String(text??'');return td;}
function connected(){return accounts.filter(a=>a.status==='Connected');}
function initials(name){return name.split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();}
function avatar(account){const span=document.createElement('span');span.className='avatar';span.textContent=initials(account.display_name);return span;}
function formatDate(iso){return new Date(iso).toLocaleString(undefined,{timeZone:DEFAULT_ZONE});}
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
    label.append(input,avatar(account),name);root.append(label);
  }
  $('selected-count').textContent=selected.size+' profiles selected';
  $('preview-profile').textContent=profiles.filter(a=>selected.has(a.id)).map(a=>a.display_name).join(', ')||'LinkedIn';
  renderScheduleRows();
}
function chosenScheduleRows(){return [...selected].map(accountId=>({accountId,...profileSchedules.get(accountId)}));}
function renderScheduleRows(){
 const root=$('schedule-rows');root.replaceChildren();
 for(const account of connected().filter(a=>selected.has(a.id))){
  const zone=profileZone(postingPreferences,account.id);
  let state=profileSchedules.get(account.id);
  if(!state){const day=composerDay||localParts(Date.now(),zone).day;state={day,time:profileTime(postingPreferences,account.id,day)||'',useDefaults:true};profileSchedules.set(account.id,state);}
  const row=document.createElement('fieldset');row.className='profile-schedule';
  const legend=document.createElement('legend');legend.textContent=account.display_name;row.append(legend);
  const zoneLabel=document.createElement('div');zoneLabel.textContent='Time zone: '+zone.replaceAll('_',' ');row.append(zoneLabel);
  const defaultsLabel=document.createElement('label'),defaults=document.createElement('input');defaults.type='checkbox';defaults.checked=state.useDefaults;defaults.setAttribute('aria-label','Use profile times — '+account.display_name);defaultsLabel.append(defaults,document.createTextNode('Use profile times'));row.append(defaultsLabel);
  const dayLabel=document.createElement('label');dayLabel.textContent='Date and time';const day=document.createElement('input');day.type='date';day.required=true;day.value=state.day;day.setAttribute('aria-label','Date — '+account.display_name);
  const time=document.createElement('input');time.type='time';time.value=state.time;time.setAttribute('aria-label','Posting time — '+account.display_name);dayLabel.append(day,time);row.append(dayLabel);
  const equivalent=document.createElement('div');row.append(equivalent);
  const custom=document.createElement('button');custom.type='button';custom.className='secondary';custom.textContent='Use custom time';custom.hidden=true;row.append(custom);
  const warning=document.createElement('div');warning.className='schedule-error';warning.setAttribute('role','alert');row.append(warning);
  const update=()=>{
   defaults.checked=state.useDefaults;
   const defaultTime=state.day?profileTime(postingPreferences,account.id,state.day):'';
   if(state.useDefaults)state.time=defaultTime||'';
   time.value=state.time;time.disabled=state.useDefaults&&defaultTime===null;time.required=!time.disabled;
   warning.textContent='';warning.hidden=true;time.hidden=time.disabled;custom.hidden=!time.disabled;
   if(time.disabled){equivalent.textContent='No default time for this day';return;}
   try{const plan=resolveProfileRows(postingPreferences,[{accountId:account.id,...state}]);const p=localParts(plan.scheduledTimes[account.id],DEFAULT_ZONE);equivalent.textContent='Singapore equivalent: '+p.day+' '+p.time;}
   catch(error){equivalent.textContent='';warning.textContent=error.message;warning.hidden=false;}
  };
  custom.addEventListener('click',()=>{state.useDefaults=false;state.time=Object.values(postingPreferences.profiles[account.id]||{}).find(Boolean)||'10:00';update();validateScheduleTime();time.focus();});
  day.addEventListener('input',()=>{state.day=day.value;update();validateScheduleTime();});
  time.addEventListener('input',()=>{state.time=time.value;state.useDefaults=false;update();validateScheduleTime();});
  defaults.addEventListener('change',()=>{state.useDefaults=defaults.checked;update();validateScheduleTime();});
  update();root.append(row);
 }
 validateScheduleTime();
}
function validateScheduleTime(){
 const warning=$('schedule-warning');
 const feedback=scheduleFeedback(postingPreferences,chosenScheduleRows(),accounts);
 warning.textContent=feedback.message;warning.hidden=!feedback.message;
 $('schedule').disabled=scheduleBusy||!feedback.valid;
 return feedback.valid;
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
    if(action==='edit'&&!['draft','scheduled'].includes(job.status))continue;
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
    if(listFilter==='draft'?job.status!=='draft':listFilter==='published'?job.status!=='published':['draft','published'].includes(job.status))continue;
    const row=document.createElement('tr');
    const profile=accounts.find(a=>a.id===job.account_id)?.display_name||job.account_id;
    const text=job.content;
    row.append(cell(profile),cell([text,job.attachment_name].filter(Boolean).join(' | ')),
      cell(job.status==='draft'?'—':formatDate(job.scheduled_at)),cell(job.status));
    const actions=document.createElement('td');actions.append(postActions(job));row.append(actions);
    tbody.append(row);
  }
  $('list-title').textContent=listFilter==='draft'?'Drafts':listFilter==='published'?'Published':'Scheduled posts';
  if(!tbody.children.length){const row=document.createElement('tr'),td=cell(listFilter==='draft'?'No drafts':listFilter==='published'?'No published posts':'No posts scheduled');td.colSpan=5;row.append(td);tbody.append(row);}
}
function renderCalendar(){
  const first=new Date(month.getFullYear(),month.getMonth(),1);
  $('month-label').textContent=first.toLocaleString(undefined,{month:'long',year:'numeric'});
  $('calendar-timezone').textContent=DEFAULT_ZONE;
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
      composerDay=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      profileSchedules.clear();refreshComposerProfiles();
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
    if(calendarDay(date)===localParts(Date.now(),DEFAULT_ZONE).day)tile.classList.add('today');
    const number=document.createElement('span');number.className='day-number';number.textContent=date.getDate();tile.append(number);
    const dayJobs=jobs.filter(j=>j.status!=='draft'&&localParts(j.scheduled_at,DEFAULT_ZONE).day===calendarDay(date));
    for(const job of dayJobs){
      const item=document.createElement('div');item.className='calendar-post';
      const name=accounts.find(a=>a.id===job.account_id)?.display_name||job.account_id;
      item.draggable=job.status==='scheduled';
      item.addEventListener('dragstart',e=>{if(!item.draggable||e.target.closest('button')){e.preventDefault();return;}draggedJob=job.id;e.dataTransfer.setData('text/plain',job.id);e.dataTransfer.effectAllowed='move';});
      item.addEventListener('dragend',()=>{draggedJob=null;});
      item.textContent=new Date(job.scheduled_at).toLocaleTimeString([],{timeZone:DEFAULT_ZONE,hour:'numeric',minute:'2-digit'})+' · '+name;
      item.title=(job.content||job.attachment_name||'Post')+' — '+job.status;
      item.append(postActions(job));
      tile.append(item);
    }
    root.append(tile);
  }
}
function setView(next){
  $('nav-drafts').classList.toggle('active',next==='list'&&listFilter==='draft');$('nav-publish').classList.toggle('active',!(next==='list'&&listFilter==='draft'));
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
  if(!draft){composerDay=null;profileSchedules.clear();}
  if(draft){
    editingDraft=draft;previousSelection=[...selected];selected.clear();selected.add(draft.account_id);
    $('content').value=draft.content;$('attachment').value='';
    const zone=profileZone(postingPreferences,draft.account_id),p=localParts(draft.scheduled_at,zone);
    profileSchedules.clear();profileSchedules.set(draft.account_id,{day:p.day,time:p.time,useDefaults:false});
  }
  $('save-draft').hidden=editingDraft?.status!=='draft';$('composer-title').textContent=editingDraft?(editingDraft.status==='scheduled'?'Edit post':'Edit draft'):'Create Post';$('schedule').textContent=editingDraft?.status==='scheduled'?'Save':'Schedule Posts';
  $('composer-overlay').hidden=false;refreshProfiles();refreshComposerProfiles();updatePreview();
  $('content').focus();
}
function closeComposer(){
  $('composer-overlay').hidden=true;
  if(editingDraft){
    editingDraft=null;selected.clear();for(const id of previousSelection)selected.add(id);
    $('content').value='';$('attachment').value='';composerDay=null;profileSchedules.clear();refreshProfiles();refreshComposerProfiles();updatePreview();
  }
}
function updatePreview(){
  $('preview-text').textContent=$('content').value;
  $('count').textContent=$('content').value.length+' / 3000';
  for(const url of previewImageUrls)URL.revokeObjectURL(url);previewImageUrls=[];
  const root=$('preview-attachment');root.replaceChildren();
  const files=[...$('attachment').files];
  const media=files.length?files.map(file=>({file,filename:file.name,mime:file.type})):editingDraft?.attachments||[];
  for(const item of media){
    if(['image/png','image/jpeg','image/gif'].includes(item.mime)){
      const img=document.createElement('img');img.alt=item.filename;
      if(item.file){const url=URL.createObjectURL(item.file);previewImageUrls.push(url);img.src=url;}
      else img.src='/api/media/'+encodeURIComponent(item.id);
      root.append(img);
    }else{const label=document.createElement('span');label.textContent=item.filename;root.append(label);}
  }
  if(!media.length&&editingDraft?.attachment_name)root.textContent=editingDraft.attachment_name;
  root.hidden=!root.childNodes.length;
  root.classList.toggle('image-preview',Boolean(root.querySelector('img')));
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
$('list-view').addEventListener('click',()=>{listFilter='scheduled';setView('list');});
$('nav-drafts').addEventListener('click',()=>{listFilter='draft';setView('list');});
$('filter-scheduled').addEventListener('click',()=>{listFilter='scheduled';setView('list');});
$('filter-published').addEventListener('click',()=>{listFilter='published';setView('list');});
$('prev-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);renderCalendar();});
$('next-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);renderCalendar();});
$('today').addEventListener('click',()=>{const d=localParts(Date.now(),DEFAULT_ZONE).day.split('-').map(Number);month=new Date(d[0],d[1]-1,1);renderCalendar();});
$('content').addEventListener('input',updatePreview);
$('attachment').addEventListener('change',updatePreview);
async function uploadAttachments(accountIds,files){
  const attachmentIds={};
  if(files.length>20)throw Error('Select 1–20 images');
  if(files.length>1&&files.some(f=>!['image/png','image/jpeg','image/gif'].includes(f.type)))throw Error('Multiple attachments must all be images');
  for(const file of files){
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
        (attachmentIds[accountId]??=[]).push(result.uploadId);
      }
    }
  for(const id of Object.keys(attachmentIds))if(attachmentIds[id].length===1)attachmentIds[id]=attachmentIds[id][0];
  return attachmentIds;
}
$('save-draft').addEventListener('click',async()=>{
  if(editingDraft?.status!=='draft')return;
  const button=$('save-draft');scheduleBusy=true;button.disabled=true;$('schedule').disabled=true;
  try{
    const draft=editingDraft;
    const attachmentIds=await uploadAttachments([draft.account_id],[...$('attachment').files]);
    await api('/api/draft','POST',{id:draft.id,content:$('content').value,attachmentId:attachmentIds[draft.account_id]});
    closeComposer();await refresh();listFilter='draft';setView('list');
  }catch(error){show(error.message,true);}finally{scheduleBusy=false;button.disabled=false;$('schedule').disabled=!scheduleFeedback(postingPreferences,chosenScheduleRows(),accounts).valid;}
});
$('schedule-form').addEventListener('submit',async e=>{
  e.preventDefault();show('');
  const button=$('schedule');scheduleBusy=true;button.disabled=true;$('save-draft').disabled=true;
  try{
    let accountIds=[...selected];
    if(!accountIds.length)throw Error('Select at least one LinkedIn profile');
    if(!validateScheduleTime())return;
    const rows=chosenScheduleRows(),plan=resolveProfileRows(postingPreferences,rows);accountIds=plan.accountIds;
    const date=new Date(plan.scheduledTimes[accountIds[0]]);
    const files=[...$('attachment').files];
    const content=$('content').value;
    if(!content.trim()&&!files.length&&!editingDraft?.attachment_name)throw Error('Enter a post or select an attachment');
    const attachmentIds=await uploadAttachments(accountIds,files);
    if(editingDraft)await api(editingDraft.status==='scheduled'?'/api/edit-post':'/api/draft','POST',{id:editingDraft.id,content,scheduledAt:plan.scheduledTimes[editingDraft.account_id],schedule:true,attachmentId:attachmentIds[editingDraft.account_id]});
    else await api('/api/profile-jobs','POST',{rows,content,attachmentIds});
    $('content').value='';$('attachment').value='';updatePreview();
    await refresh();closeComposer();show('Post scheduled for '+accountIds.length+' profiles');
    const shown=localParts(date,DEFAULT_ZONE).day.split('-').map(Number);month=new Date(shown[0],shown[1]-1,1);setView('calendar');
  }catch(error){show(error.message,true);$('schedule-warning').textContent=error.message;$('schedule-warning').hidden=false;}finally{scheduleBusy=false;button.disabled=!scheduleFeedback(postingPreferences,chosenScheduleRows(),accounts).valid;$('save-draft').disabled=false;}
});
async function init(){
  try{const session=await api('/api/session');csrf=session.csrf||'';
    setLoggedIn(session.authenticated);
    if(session.authenticated){
      postingPreferences=await api('/api/posting-times');
      const today=localParts(Date.now(),DEFAULT_ZONE).day.split('-').map(Number);month=new Date(today[0],today[1]-1,1);
      await refresh();
    }else if(session.setup)show(session.setup,true);
    setView('calendar');
  }catch(error){show(error.message,true);}
}
init();
setInterval(()=>{if(!$('workspace').hidden)refresh().catch(e=>show(e.message,true));},30000);


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
  const zones=$('posting-zone'),current=zones.value||profileZone(editingPreferences,$('posting-profile').value);
  const query=$('zone-city').value.trim().toLocaleLowerCase().replaceAll('_',' ');
  const matches=[...new Set(['Asia/Singapore',profileZone(editingPreferences,$('posting-profile').value),...Intl.supportedValuesOf('timeZone')])].filter(zone=>zone.toLocaleLowerCase().replaceAll('_',' ').includes(query));
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
  editingPreferences=await api('/api/posting-times');editingPreferences.profileZones??={};const profiles=$('posting-profile');profiles.replaceChildren();
  for(const account of accounts){const option=document.createElement('option');option.value=account.id;option.textContent=account.display_name;profiles.append(option);}
  editingZoneProfile=profiles.value;$('posting-zone').replaceChildren();$('zone-city').value='';searchTimeZones();drawPostingWeek();$('posting-dialog').showModal();
 }catch(error){show(error.message,true);}
});
$('posting-profile').addEventListener('change',()=>{
 if(editingZoneProfile&&$('posting-zone').value)editingPreferences.profileZones[editingZoneProfile]=$('posting-zone').value;
 editingZoneProfile=$('posting-profile').value;$('posting-zone').replaceChildren();$('zone-city').value='';searchTimeZones();drawPostingWeek();
});
$('posting-close').addEventListener('click',()=>$('posting-dialog').close());
$('posting-form').addEventListener('submit',async e=>{
 e.preventDefault();try{editingPreferences.profileZones[$('posting-profile').value]=$('posting-zone').value;postingPreferences=await api('/api/posting-times','POST',editingPreferences);$('posting-dialog').close();renderList();renderCalendar();refreshComposerProfiles();}catch(error){show(error.message,true);}
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
