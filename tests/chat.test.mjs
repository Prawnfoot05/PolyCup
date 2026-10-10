import { Controller } from '../.research/test-src/controller.ts';
import * as Cup from '../.research/test-src/cup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CupChat } from '../.research/test-src/chat.ts';
import { filterChat } from '../.research/test-src/chat-filter.ts';

function room() {
 let cupId='cup-one';const peers=[{id:1,name:'Host',key:'host'},{id:2,name:'Guest',key:'profile-guest'},{id:3,name:'Spectator',key:'profile-spec'}];
 const messages=[],clients=new Map();
 const make=(id,host=false)=>new CupChat({context:()=>({cupId,host,selfId:id,peers}),changed(){},send(to,m){messages.push({from:id,to,m});if(host)clients.get(to)?.receive(0,m);else hostChat.receive(id,m);return true;}});
 const hostChat=make(1,true),guest=make(2),spectator=make(3);clients.set(2,guest);clients.set(3,spectator);
 return {host:hostChat,guest,spectator,peers,messages,setCup:id=>{cupId=id;},make,clients};
}
test('chat masks slurs, obfuscation and explicit hateful phrases without censoring ordinary profanity or innocent substrings',()=>{
 for(const input of ['nigger','N1GG3R','n.i.g.g.e.r','n\u200biggér','faggot','f4gg0t','kike','kill all jews','white power']) {
  const result=filterChat(input);assert.notEqual(result,input,input);assert.ok(result.includes('*'),input);
 }
 assert.equal(filterChat('🏎️ n1gger 👋'), '🏎️ ****** 👋');
 assert.equal(filterChat('😀 faggot'), '😀 ******');
 for(const input of ['fuck this shit','fucking hell','Scunthorpe','class assignment','Pakistan','spicy corner','raccoon','gay racer','Jewish player','trans rights'])assert.equal(filterChat(input),input);
});
test('host authors filtered messages from native identities, delivers to racers and spectators and rejects spoofed senders',async()=>{
 const r=room();await r.guest.post('fuck, that corner is shit');await r.spectator.post('n1gger');
 assert.equal(r.host.lines.length,2);assert.equal(r.guest.lines[0].name,'Guest');assert.equal(r.spectator.lines[0].text,'fuck, that corner is shit');
 assert.equal(r.host.lines[1].text,'******');assert.deepEqual(r.guest.lines,r.host.lines);
 r.host.receive(99,{type:'chat-post',cupId:'cup-one',requestId:'fake',text:'spoof',name:'Host'});
 r.guest.receive(3,{type:'chat-line',cupId:'cup-one',line:{...r.host.lines[0],seq:3,text:'spoof'}});assert.equal(r.host.lines.length,2);assert.equal(r.guest.lines.length,2);
});
test('chat limits spam, deduplicates retries, and retains messages beyond preview and history-page limits',async()=>{
 const r=room();await r.guest.post('one');await r.guest.post('two');await r.guest.post('three');await assert.rejects(r.guest.post('four'),/Slow down/);
 const original=r.messages.find(x=>x.m.type==='chat-post').m;r.host.receive(2,original);assert.equal(r.host.lines.length,3);
 const archive=r.host.archive();archive.lines=Array.from({length:105},(_,i)=>({...archive.lines[0],seq:i+1,text:`Line ${i+1}`}));r.host.restore(archive,'cup-one');
 const newcomer=r.make(3);r.clients.set(3,newcomer);
 for(let i=0;i<4;i++){r.host.reads.clear();newcomer.nextRead=0;newcomer.tick();}
 assert.equal(newcomer.lines.length,105);assert.equal(newcomer.lines[0].text,'Line 1');assert.equal(newcomer.lines.at(-1).text,'Line 105');
 assert.ok(r.messages.filter(x=>x.m.type==='chat-page').every(x=>x.m.lines.length<=32&&JSON.stringify(x.m).length<60000));
});
test('host mute follows a verified account across peer-ID changes and survives export/restore',async()=>{
 const r=room();await r.guest.post('hello');const first=r.host.lines[0];r.host.mute(first.speaker,true);
 await assert.rejects(r.guest.post('muted'),/muted/);assert.throws(()=>r.guest.mute(first.speaker,true),/Only the organizer/);
 r.peers[1].id=4;const returned=r.make(4);r.clients.set(4,returned);await assert.rejects(returned.post('still muted'),/muted/);
 const saved=JSON.parse(JSON.stringify(r.host.archive()));r.host.restore(saved,'cup-one');await assert.rejects(returned.post('still muted after restore'),/muted/);
 r.host.mute(first.speaker,false);await returned.post('back');assert.equal(r.host.lines[1].color,first.color);assert.equal(r.host.lines[1].speaker,first.speaker);
 assert.equal(r.host.archive().lines.length,2);
});
test('chat isolates Cups, rejects oversized and stale messages, and validates saved logs',async()=>{
 const r=room();await r.host.post('old Cup');r.setCup('cup-two');r.host.tick();r.guest.tick();assert.equal(r.host.lines.length,0);assert.equal(r.guest.lines.length,0);
 await assert.rejects(r.guest.post('x'.repeat(401)),/characters/);
 r.host.receive(2,{type:'chat-post',cupId:'cup-one',requestId:'stale',text:'old'});assert.equal(r.host.lines.length,0);
 assert.throws(()=>r.host.restore({cupId:'cup-two',speakers:[],lines:[{seq:2}]},'cup-two'),/Invalid/);
 r.peers[1].key=undefined;await assert.rejects(r.guest.post('unverified'),/Verifying/);
});


test('organizer Cup autosave and restore preserve full filtered chat independently of race snapshots',async()=>{
 const c=new Controller(()=>{});c.isHost=true;c.selfId=1;c.connection={};c.lobby=[{id:1,nickname:'Host',isSelf:true}];c.state=Cup.newCup();
 await c.chat.post('fuck that corner');await c.chat.post('n1gger');
 const exported=c.saveData();assert.equal(exported.chat.lines[1].text,'******');assert.equal(c.networkState().chat,undefined);
 c.restore(JSON.stringify(exported));assert.equal(c.chat.lines.length,2);assert.equal(c.chat.lines[0].text,'fuck that corner');assert.equal(c.saveData().chat.lines[1].text,'******');
});
