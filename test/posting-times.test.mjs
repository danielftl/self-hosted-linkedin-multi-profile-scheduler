import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPreferences,validatePreferences,zonedInstant,resolveDay,localParts,resolveProfileRows,profileZone,scheduleFeedback} from '../public/posting-times.js';
test('profile weekday times resolve independently in Singapore and skip disabled days',()=>{
 const p=defaultPreferences();p.profiles={a:{0:null,1:'10:00',2:'10:00',3:'10:00',4:'10:00',5:'10:00',6:null},b:{0:null,1:'15:00',2:'15:00',3:'15:00',4:'15:00',5:'15:00',6:null},c:{0:null,1:null,2:null,3:null,4:null,5:null,6:null}};
 assert.equal(validatePreferences(p).timeZone,'Asia/Singapore');
 const plan=resolveDay(p,['a','b','c','d'],'2030-01-01',0);
 assert.deepEqual(plan.accountIds,['a','b','d']);assert.deepEqual(plan.skipped,['c']);
 assert.equal(plan.scheduledTimes.a,'2030-01-01T02:00:00.000Z');assert.equal(plan.scheduledTimes.b,'2030-01-01T07:00:00.000Z');
 assert.equal(localParts(plan.scheduledTimes.b,p.timeZone).time,'15:00');
 assert.throws(()=>resolveDay(p,['c'],'2030-01-01',0),/No selected/);
 assert.throws(()=>resolveDay(p,['a'],'2030-01-01',Date.parse('2030-01-02')),/future/);
});
test('time-zone conversion handles DST and rejects missing/ambiguous local times',()=>{
 assert.equal(zonedInstant('2030-07-01','10:00','America/New_York'),'2030-07-01T14:00:00.000Z');
 assert.equal(zonedInstant('2030-01-01','10:00','America/New_York'),'2030-01-01T15:00:00.000Z');
 assert.throws(()=>zonedInstant('2027-03-14','02:30','America/New_York'),/missing or ambiguous/);
 assert.throws(()=>zonedInstant('2027-11-07','01:30','America/New_York'),/missing or ambiguous/);
 assert.throws(()=>zonedInstant('2030-02-30','10:00'),/valid date/);
 assert.throws(()=>validatePreferences({timeZone:'invalid',profiles:{}}),/valid time zone/);
});

test('profile zones and independent custom/default rows resolve to explicit instants',()=>{
 const p=defaultPreferences();p.profileZones={celest:'Asia/Singapore',farouq:'Africa/Lagos'};
 p.profiles={celest:Object.fromEntries(Array.from({length:7},(_,d)=>[d,'10:00'])),farouq:Object.fromEntries(Array.from({length:7},(_,d)=>[d,'15:00']))};
 const valid=validatePreferences(p);assert.equal(valid.profileZones.farouq,'Africa/Lagos');
 const plan=resolveProfileRows(valid,[{accountId:'celest',day:'2030-01-01',time:'23:25',useDefaults:false},{accountId:'farouq',day:'2030-01-01',time:'23:25',useDefaults:false}],0);
 assert.equal(plan.scheduledTimes.celest,'2030-01-01T15:25:00.000Z');assert.equal(plan.scheduledTimes.farouq,'2030-01-01T22:25:00.000Z');
 assert.deepEqual(localParts(plan.scheduledTimes.farouq,'Asia/Singapore'),{day:'2030-01-02',time:'06:25',second:'00'});
 const mixed=resolveProfileRows(valid,[{accountId:'celest',day:'2030-01-01',time:'11:00',useDefaults:false},{accountId:'farouq',day:'2030-01-02',useDefaults:true}],0);
 assert.equal(mixed.scheduledTimes.celest,'2030-01-01T03:00:00.000Z');assert.equal(mixed.scheduledTimes.farouq,'2030-01-02T14:00:00.000Z');
 p.profiles.farouq[2]=null;assert.deepEqual(resolveDay(p,['celest','farouq'],'2030-01-01',0).skipped,['farouq']);
 assert.throws(()=>resolveProfileRows(valid,[{accountId:'celest',day:'2030-01-01',time:'23:25',useDefaults:false}],Date.parse('2030-01-02')),/future/);
 const legacy=validatePreferences({timeZone:'Africa/Lagos',profiles:{}});assert.equal(profileZone(legacy,'celest'),'Asia/Singapore');
 assert.throws(()=>validatePreferences({...p,profileZones:{farouq:'bad-zone'}}),/valid time zone/);
});

test('a missing custom time cannot silently skip a selected profile',()=>{assert.throws(()=>resolveProfileRows(defaultPreferences(),[{accountId:'a',day:'2030-01-01',time:null,useDefaults:false}],0),/valid posting time/);});

test('scheduling feedback names skipped profiles and blocks empty or invalid batches',()=>{
 const p=defaultPreferences();p.profileZones={a:'Asia/Singapore',b:'Africa/Lagos'};p.profiles={a:{6:null},b:{6:null}};
 const accounts=[{id:'a',display_name:'Profile A'},{id:'b',display_name:'Profile B'}];
 const rows=[{accountId:'a',day:'2030-01-05',useDefaults:true},{accountId:'b',day:'2030-01-05',useDefaults:true}];
 const allSkipped=scheduleFeedback(p,rows,accounts,0);assert.equal(allSkipped.valid,false);assert.match(allSkipped.message,/Profile B — 2030-01-05 \(Africa\/Lagos\)/);assert.match(allSkipped.message,/Use custom time/);
 rows[1]={...rows[1],useDefaults:false,time:'10:00'};
 const partial=scheduleFeedback(p,rows,accounts,0);assert.equal(partial.valid,true);assert.match(partial.message,/Will not be scheduled: Profile A/);assert.doesNotMatch(partial.message,/Will not be scheduled: Profile B/);
 rows[0]={...rows[0],useDefaults:false,time:'10:00'};
 assert.deepEqual(scheduleFeedback(p,rows,accounts,0),{valid:true,message:''});
 assert.equal(scheduleFeedback(p,rows,accounts,Date.parse('2030-01-06')).valid,false);
 assert.match(scheduleFeedback(p,rows,accounts,Date.parse('2030-01-06')).message,/Profile B.*future date and time/);
 rows[1].time='';assert.match(scheduleFeedback(p,rows,accounts,0).message,/Profile B.*valid posting time/);
 assert.equal(scheduleFeedback(p,[],accounts,0).valid,false);
});
