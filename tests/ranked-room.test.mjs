import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankedRoomSnapshot} from '../src/ranked-room.ts';
import {standardPreset} from '../src/presets.ts';
import {raceState} from '../src/waiting-room-model.ts';
import {lockRegistration} from '../src/cup.ts';
const track=n=>String(n).padStart(64,'a');
test('ranked server choices become a valid existing Cup draft and native roster',()=>{
 const rules={...standardPreset().rules,bansPerRacer:2,picksPerRacer:2,roundsPerTrack:3,pointsToWin:140};
 const raw={id:crypto.randomUUID(),status:'drafting',host:1,self:2,ticket:crypto.randomUUID(),rules:{...rules,version:'extra server metadata'},pool:[],members:[{id:1,account:'a',name:'Alice',online:true},{id:2,account:'b',name:'Bob',online:true}],session:{revision:4,bans:[1,2,3,4].map((n,i)=>({player_id:i%2?'b':'a',track_id:track(n)})),picks:[{player_id:'a',track_id:track(5)},{player_id:'a',track_id:track(6)},{player_id:'b',track_id:track(5)},{player_id:'b',track_id:track(7)}],ready:['a','b'],chat:[],launch:null}};
 const snap=rankedRoomSnapshot(raw,{list:()=>[5,6,7].map(n=>({id:track(n),name:'Track '+n})),parse(){}});
 assert.equal(snap.data.cup.draft.stage,'picks');assert.equal(snap.data.cup.draft.banHistory.length,4);assert.deepEqual(snap.data.cup.draftReady,[1,2]);
 assert.deepEqual(snap.data.cup.tracks.map(t=>t.name),['Track 5','Track 6','Track 7']);
 const state=raceState(snap.data,new Map([[1,0],[2,8]]));lockRegistration(state);
 assert.deepEqual(state.roster.map(p=>p.id),[0,8]);assert.equal(state.preset.rules.roundsPerTrack,3);assert.equal(state.preset.rules.pointsToWin,140);assert.equal(state.preset.rules.version,undefined);
});

test('late ranked polls cannot undo a newer draft choice or resurrect a dismissed room',async()=>{
 const {RankedRoom}=await import('../src/ranked-room.ts');globalThis.window={addEventListener(){}};globalThis.sessionStorage={getItem(){return null;},setItem(){}};
 const raw={id:crypto.randomUUID(),status:'drafting',host:1,self:2,ticket:crypto.randomUUID(),rules:standardPreset().rules,pool:[],members:[{id:1,account:'a',name:'Alice',online:true},{id:2,account:'b',name:'Bob',online:true}],session:{revision:1,bans:[],picks:[],ready:[],chat:[],launch:null}};
 let resolve,delayed=false;const api={session:async(_key,_lease,action)=>delayed&&action==='poll'?new Promise(r=>resolve=r):structuredClone(raw)};
 const directory={browserClient:{rpc:()=>({abortSignal:async()=>({data:{},error:null})})}};
 const room=new RankedRoom(directory,api,raw.id,crypto.randomUUID(),{list:()=>[],parse(){}});
 try{await room.enter();delayed=true;const poll=room.poll();raw.session.revision=2;raw.session.bans=[{player_id:'a',track_id:track(1)}];await room.submit('ban',track(1));resolve({...structuredClone(raw),session:{...raw.session,revision:1,bans:[]}});await poll;assert.equal(room.snapshot.revision,2);assert.equal(room.state.draft.banHistory.length,1);
 const late=room.poll();room.dismiss();resolve(structuredClone(raw));await late;assert.equal(room.snapshot,null);
 }finally{room.dismiss();}
});

test('ranked countdown uses one server announcement without duplicating handoff seconds',()=>{
 const line={seq:1,at:1000,speaker:0,color:0,name:'',text:'Match starting in 5…',system:true};
 const raw={id:'match',status:'drafting',host:1,self:1,ticket:'ticket',rules:standardPreset().rules,pool:[],members:[{id:1,account:'a',name:'Alice',online:true},{id:2,account:'b',name:'Bob',online:true}],session:{revision:1,bans:[],picks:[],ready:[],chat:[line],launch:{id:'attempt',at:6012,stage:'connecting',code:'QA000001'}}};
 assert.deepEqual(rankedRoomSnapshot(raw,{list:()=>[],parse(){}}).data.chat,[line]);
});
