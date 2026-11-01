const $=id=>document.getElementById(id);
let csrf='',accounts=[],jobs=[],view='calendar',month=new Date();
const selected=new Set();
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
  $('new-post').disabled=!yes;$('header-new-post').disabled=!yes;
}
function formatDate(iso){return new Date(iso).toLocaleString();}
function refreshProfiles(){
  const root=$('accounts');root.replaceChildren();
  const profiles=connected();
  for(const account of accounts){
    const label=document.createElement('label');label.className='profile-row';
    const check=document.createElement('input');check.type='checkbox';check.value=account.id;
    check.checked=selected.has(account.id);check.disabled=account.status!=='Connected';
    check.addEventListener('change',()=>{check.checked?selected.add(account.id):selected.delete(account.id);refreshProfiles();refreshComposerProfiles();});
    const name=document.createElement('strong');name.textContent=account.display_name;
    const status=document.createElement('span');status.className='profile-status';status.textContent=account.status;
    label.append(check,avatar(account),name,status);root.append(label);
  }
  if(!accounts.length){const p=document.createElement('p');p.textContent='No profiles connected';root.append(p);}
  if(profiles.length){
    const all=document.createElement('button');all.className='select-all';all.type='button';
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
    input.checked=selected.has(account.id);
    input.addEventListener('change',()=>{
      input.checked?selected.add(account.id):selected.delete(account.id);
      refreshProfiles();refreshComposerProfiles();
    });
    const name=document.createElement('span');name.textContent=account.display_name;
    label.append(input,avatar(account),name);root.append(label);
  }
  $('selected-count').textContent=selected.size+' profiles selected';
  $('preview-profile').textContent=profiles.filter(a=>selected.has(a.id)).map(a=>a.display_name).join(', ')||'LinkedIn';
}
function renderList(){
  const tbody=$('jobs');tbody.replaceChildren();
  for(const job of jobs){
    const row=document.createElement('tr');
    const profile=accounts.find(a=>a.id===job.account_id)?.display_name||job.account_id;
    const text=job.content.length>130?job.content.slice(0,130)+'…':job.content;
    row.append(cell(profile),cell([text,job.attachment_name].filter(Boolean).join(' | ')),
      cell(formatDate(job.scheduled_at)),cell(job.status));
    tbody.append(row);
  }
  if(!jobs.length){const row=document.createElement('tr'),td=cell('No posts scheduled');td.colSpan=4;row.append(td);tbody.append(row);}
}
function renderCalendar(){
  const first=new Date(month.getFullYear(),month.getMonth(),1);
  $('month-label').textContent=first.toLocaleString(undefined,{month:'long',year:'numeric'});
  $('calendar-timezone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start=new Date(first);start.setDate(1-(first.getDay()+6)%7);
  const root=$('calendar');root.replaceChildren();
  for(const day of ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']){
    const label=document.createElement('div');label.className='weekday';label.textContent=day;root.append(label);
  }
  for(let i=0;i<42;i++){
    const date=new Date(start);date.setDate(start.getDate()+i);
    const tile=document.createElement('div');tile.className='day';
    if(date.getMonth()!==first.getMonth())tile.classList.add('outside');
    if(date.toDateString()===new Date().toDateString())tile.classList.add('today');
    const number=document.createElement('span');number.className='day-number';number.textContent=date.getDate();tile.append(number);
    const dayJobs=jobs.filter(j=>new Date(j.scheduled_at).toDateString()===date.toDateString());
    for(const job of dayJobs){
      const item=document.createElement('div');item.className='calendar-post';
      const name=accounts.find(a=>a.id===job.account_id)?.display_name||job.account_id;
      item.textContent=new Date(job.scheduled_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' · '+name;
      item.title=(job.content||job.attachment_name||'Post')+' — '+job.status;
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
function openComposer(){
  if($('workspace').hidden)return;
  $('composer-overlay').hidden=false;refreshComposerProfiles();updatePreview();
  $('content').focus();
}
function closeComposer(){$('composer-overlay').hidden=true;}
function updatePreview(){
  $('preview-text').textContent=$('content').value;
  $('count').textContent=$('content').value.length+' / 3000';
  const file=$('attachment').files[0];
  $('preview-attachment').hidden=!file;
  $('preview-attachment').textContent=file?.name||'';
}
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();show('');
  try{const result=await api('/api/login','POST',{password:$('password').value});
    csrf=result.csrf;$('password').value='';setLoggedIn(true);await refresh();
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
for(const id of ['new-post','header-new-post'])$(id).addEventListener('click',openComposer);
$('close-composer').addEventListener('click',closeComposer);
$('composer-overlay').addEventListener('click',e=>{if(e.target===$('composer-overlay'))closeComposer();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeComposer();});
for(const id of ['calendar-view','nav-publish'])$(id).addEventListener('click',()=>setView('calendar'));
$('list-view').addEventListener('click',()=>setView('list'));
$('prev-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);renderCalendar();});
$('next-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);renderCalendar();});
$('today').addEventListener('click',()=>{month=new Date();renderCalendar();});
$('content').addEventListener('input',updatePreview);
$('attachment').addEventListener('change',updatePreview);
$('schedule-form').addEventListener('submit',async e=>{
  e.preventDefault();show('');
  const button=$('schedule');button.disabled=true;
  try{
    const accountIds=[...selected];
    if(!accountIds.length)throw Error('Select at least one LinkedIn profile');
    const date=new Date($('date').value);
    if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())throw Error('Choose a future date and time');
    const file=$('attachment').files[0];
    const content=$('content').value;
    if(!content.trim()&&!file)throw Error('Enter a post or select an attachment');
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
    await api('/api/batch-jobs','POST',{accountIds,content,scheduledAt:date.toISOString(),attachmentIds});
    $('content').value='';$('attachment').value='';updatePreview();
    await refresh();closeComposer();show('Post scheduled for '+accountIds.length+' profiles');
    month=new Date(date);setView('calendar');
  }catch(error){show(error.message,true);}finally{button.disabled=false;}
});
async function init(){
  try{const session=await api('/api/session');csrf=session.csrf||'';
    setLoggedIn(session.authenticated);
    if(session.authenticated)await refresh();
    else if(session.setup)show(session.setup,true);
    setView('calendar');
  }catch(error){show(error.message,true);}
}
init();
setInterval(()=>{if(!$('workspace').hidden)refresh().catch(e=>show(e.message,true));},30000);
