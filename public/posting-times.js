export const DEFAULT_ZONE='Asia/Singapore';
export const defaultPreferences=()=>({timeZone:DEFAULT_ZONE,profiles:{}});
export function validatePreferences(input){
 if(!input||typeof input!=='object'||typeof input.timeZone!=='string')throw Error('Choose a time zone');
 let timeZone;try{timeZone=new Intl.DateTimeFormat('en',{timeZone:input.timeZone}).resolvedOptions().timeZone;}catch{throw Error('Choose a valid time zone');}
 if(!input.profiles||typeof input.profiles!=='object'||Array.isArray(input.profiles))throw Error('Invalid posting times');
 const profiles={};
 for(const [id,week] of Object.entries(input.profiles)){
  if(!week||typeof week!=='object'||Array.isArray(week))throw Error('Invalid posting times');
  profiles[id]={};
  for(let day=0;day<7;day++){
   const time=week[day];if(time!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))throw Error('Choose a valid posting time');
   profiles[id][day]=time;
  }
 }
 return {timeZone,profiles};
}
export function localParts(instant,zone=DEFAULT_ZONE){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(x=>[x.type,x.value]));
 return {day:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`,second:parts.second};
}
export function weekday(day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Choose a valid date');
 const date=new Date(day+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)throw Error('Choose a valid date');
 return date.getUTCDay();
}
export function profileTime(preferences,id,day){return preferences.profiles[id]?.[weekday(day)]===undefined?'10:00':preferences.profiles[id][weekday(day)];}
export function zonedInstant(day,time,zone=DEFAULT_ZONE){
 weekday(day);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))throw Error('Choose a valid posting time');
 const base=Date.parse(day+'T'+time+':00Z'),offsets=new Set();
 for(const delta of [-86400000,0,86400000]){
  const probe=base+delta,p=localParts(probe,zone);
  offsets.add(Date.parse(p.day+'T'+p.time+':'+p.second+'Z')-probe);
 }
 const matches=[...offsets].map(offset=>base-offset).filter(t=>{const p=localParts(t,zone);return p.day===day&&p.time===time;});
 if(matches.length!==1)throw Error('Choose another time: daylight-saving time is missing or ambiguous');
 return new Date(matches[0]).toISOString();
}
export function resolveDay(preferences,ids,day,now=Date.now()){
 if(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length||ids.some(x=>typeof x!=='string'))throw Error('Select valid profiles');
 const scheduledTimes={},skipped=[];
 for(const id of ids){const time=profileTime(preferences,id,day);if(time===null){skipped.push(id);continue;}
  const instant=zonedInstant(day,time,preferences.timeZone);if(Date.parse(instant)<=now)throw Error('Choose a future date and time');scheduledTimes[id]=instant;
 }
 if(!Object.keys(scheduledTimes).length)throw Error('No selected profile has a posting time for this day');
 return {accountIds:Object.keys(scheduledTimes),scheduledTimes,skipped};
}
