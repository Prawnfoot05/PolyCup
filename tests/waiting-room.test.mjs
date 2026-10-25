import assert from 'node:assert/strict';
import {test} from 'node:test';
import {roomData,reduceRoomEvent,reconcileRoom,raceState} from '../src/waiting-room-model.ts';
import * as Cup from '../src/cup.ts';
const members=[{id:1,name:'Same name',online:true,country:null},{id:2,name:'Same name',online:true,country:null}];
const pool=Array.from({length:8},(_,i)=>({id:String(i+1).padStart(64,'0'),name:`Track ${i+1}`,category:'official'}));
const tracks={list:()=>pool,parse:()=>({...pool[0],category:'custom'})};
const event=(actor,kind,value)=>({actor,kind,value,seq:1,request:crypto.randomUUID()});
function apply(data,actor,kind,value,now=1000){return reduceRoomEvent(data,event(actor,kind,value),members,1,tracks,now);}
function draft(){let d=roomData('Test Cup');d.cup.preset.rules.bansPerRacer=0;d=apply(d,1,'join');d=apply(d,2,'join');d=apply(d,1,'begin');d=apply(d,1,'pick',pool[0].id);d=apply(d,2,'pick',pool[1].id);return d;}

test('explicitly departed setup members release slots while offline racers retain theirs',()=>{
 let d=roomData('Reconnect');d=apply(d,1,'join');d=apply(d,2,'join');
 reconcileRoom(d,[members[0],{...members[1],online:false}]);
 assert.deepEqual(d.cup.roster.map(p=>p.id),[1,2]);
 reconcileRoom(d,[members[0]]);assert.deepEqual(d.cup.roster.map(p=>p.id),[1]);
 const replacement={...members[1],id:3};
 d=reduceRoomEvent(d,event(3,'join'),[members[0],replacement],1,tracks);
 assert.deepEqual(d.cup.roster.map(p=>p.id),[1,3]);
});
test('waiting-room host authority and invalid actions preserve original state',()=>{
 const data=roomData('Test');assert.throws(()=>apply(data,2,'begin'),/Only the host/);assert.equal(data.cup.roster.length,0);
 assert.throws(()=>reduceRoomEvent(data,event(99,'join'),members,1,tracks),/Rejoin/);
});
test('full picks, readiness locks and countdown cancellation reuse Cup rules',()=>{
 let d=draft();assert.throws(()=>apply(d,1,'pick',pool[2].id),/Remove a pick/);
 assert.throws(()=>apply(d,1,'start'),/ready/i);
 d=apply(d,1,'draft-ready','ready');d=apply(d,2,'draft-ready','ready');
 const started=apply(d,1,'start');assert.equal(started.launch.stage,'grace');assert.equal(started.launch.at,6000);
 assert.equal(started.chat.at(-1).text,'Match starting in 5…');
 const cancelled=apply(started,2,'draft-ready','editing',5999);
 assert.equal(cancelled.launch,null);assert.deepEqual(cancelled.cup.picks,d.cup.picks);
 assert.equal(Cup.draftReady(cancelled.cup,1),true);assert.equal(Cup.draftReady(cancelled.cup,2),false);
});
test('connection failure retains draft; retry gets a different attempt',()=>{
 let d=draft();for(const p of members)d=apply(d,p.id,'draft-ready','ready');
 d=apply(d,1,'start');const previous=d.launch.id;d.launch.stage='connecting';
 assert.throws(()=>apply(d,2,'pick',pool[2].id),/connecting/);
 d=apply(d,1,'cancel');assert.equal(d.launch,null);assert.equal(d.cup.tracks.length,2);
 d=apply(d,1,'start');assert.notEqual(d.launch.id,previous);
 reconcileRoom(d,[members[0],{...members[1],online:false}]);assert.equal(d.launch,null);assert.equal(d.cup.tracks.length,2);
});
test('handoff remaps all draft references by verified member identity, not names',()=>{
 const data=draft(), mapped=raceState(data,new Map([[1,7],[2,3]]));
 assert.deepEqual(mapped.roster.map(p=>p.id),[7,3]);assert.equal(mapped.picks[7],data.cup.picks[1]);
 assert.ok(mapped.draft.order.includes(7));assert.equal(data.cup.roster[0].id,1);
 assert.throws(()=>raceState(data,new Map([[1,7]])),/every racer/);
 assert.throws(()=>raceState(data,new Map([[1,7],[2,7]])),/Duplicate/);
 Cup.lockRegistration(mapped);assert.deepEqual(Cup.currentMatch(mapped).players,[7,3]);
});
