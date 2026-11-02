import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPreferences,validatePreferences,zonedInstant,resolveDay,localParts} from '../public/posting-times.js';
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
