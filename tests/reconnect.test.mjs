import test from 'node:test';
import assert from 'node:assert/strict';
import { profileIdentity, ReconnectRegistry } from '../src/reconnect.ts';

async function verify(registry, id, identity) {
  const nonce=registry.challenge(id,identity.publicKey);
  assert.ok(nonce);
  assert.equal(await registry.prove(id,nonce,await identity.sign(nonce)),true);
}

test('profile proof is stable across sessions, distinct across profiles and Cups, and exposes no credential', async()=>{
  const a=await profileIdentity('test-profile-A','cup-A');
  const again=await profileIdentity('test-profile-A','cup-A');
  const b=await profileIdentity('test-profile-B','cup-A');
  const otherCup=await profileIdentity('test-profile-A','cup-B');
  assert.equal(a.publicKey,again.publicKey);
  assert.notEqual(a.publicKey,b.publicKey);assert.notEqual(a.publicKey,otherCup.publicKey);
  assert.deepEqual(Object.keys(a).sort(),['publicKey','sign']);
  assert.ok(!JSON.stringify(a).includes('test-profile-A'));
});

test('only proof of the original profile can recover a racer after native peer ID changes',async()=>{
  const registry=new ReconnectRegistry();registry.reset('cup-A');
  const original=await profileIdentity('test-profile-A','cup-A');
  await verify(registry,2,original);registry.sync([1,2],[2]);
  registry.sync([1], [2]);assert.equal(registry.owner(2),null);
  const impostor=await profileIdentity('same-name-different-profile','cup-A');
  await verify(registry,8,impostor);assert.equal(registry.owner(8),null);
  const nonce=registry.challenge(8,original.publicKey);
  assert.equal(await registry.prove(8,nonce,await impostor.sign(nonce)),false);
  await verify(registry,9,await profileIdentity('test-profile-A','cup-A'));
  assert.equal(registry.owner(9),2);
  registry.rebind(2,9);registry.sync([1,9],[9]);assert.equal(registry.owner(9),9);
});

test('proofs are single-use, peer-bound, Cup-bound, and invalid after Cup closure',async()=>{
  const registry=new ReconnectRegistry();registry.reset('cup-A');
  const a=await profileIdentity('test-profile-A','cup-A');
  const nonce=registry.challenge(2,a.publicKey), signature=await a.sign(nonce);
  assert.equal(await registry.prove(3,nonce,signature),false);
  assert.equal(await registry.prove(2,nonce,signature),true);
  assert.equal(await registry.prove(2,nonce,signature),false);
  registry.sync([2],[2]);
  const next=registry.challenge(9,a.publicKey), proof=await a.sign(next);
  registry.reset('cup-B');assert.equal(await registry.prove(9,next,proof),false);
  registry.reset('');assert.equal(registry.owner(2),null);assert.equal(registry.challenge(2,a.publicKey),null);
});

test('account proof automatically restores a disconnected racer at a safe boundary',async()=>{
  const {Controller}=await import('../.research/test-src/controller.ts');
  const Cup=await import('../.research/test-src/cup.ts');
  const host=new Controller(()=>{});host.isHost=true;host.selfId=1;host.connection={};
  host.state=Cup.newCup('Reconnect');
  host.state.roster=[{id:2,name:'Anonymous'},{id:1,name:'Host'}];
  const trackId='a'.repeat(64);host.state.tracks=[{id:trackId,name:'Track'}];host.state.picks={1:trackId,2:trackId};
  Cup.lockRegistration(host.state);host.state.matches[0].scores[2]=48;
  host.lobby=[{id:1,isSelf:true,nickname:'Host'},{id:2,nickname:'Anonymous'}];host.hello=new Set([2,9,8]);
  host.transport.has=()=>true;host.save=()=>{};host.broadcast=()=>{};
  const replies=[];host.transport.send=(id,m)=>{replies.push({id,...m});return true;};
  const identity=await profileIdentity('test-profile-A',host.state.id);
  const cupId=host.state.id;
  const register=async (id,key=identity)=>{
    await host.receiveReconnect(id,{type:'identity-open',cupId,publicKey:key.publicKey});
    const challenge=replies.at(-1);
    await host.receiveReconnect(id,{type:'identity-proof',cupId,nonce:challenge.nonce,signature:await key.sign(challenge.nonce)});
  };
  await register(2);
  host.lobby=[{id:1,isSelf:true,nickname:'Host'},{id:9,nickname:'Renamed'},{id:8,nickname:'Anonymous'}];
  host.syncReconnect();
  await register(8,await profileIdentity('another-profile',cupId));
  assert.equal(host.state.roster[0].id,2,'same name cannot recover another account');
  assert.throws(()=>host.rebindRacer(2,8,'Anonymous'),/proved ownership/);
  host.state.runtime={id:'live'};
  await register(9);
  assert.equal(replies.at(-1).type,'reconnect-queued');assert.equal(host.state.roster[0].id,2);
  host.applyReconnects();assert.equal(host.state.roster[0].id,2,'no mid-race identity changes');
  host.state.runtime=null;host.applyReconnects();
  assert.equal(host.state.roster[0].id,9);assert.equal(host.state.roster[0].name,'Renamed');
  assert.equal(host.state.matches[0].scores[9],48);assert.equal(host.state.matches[0].scores[2],undefined);
  assert.equal(host.state.picks[9],trackId);
  assert.equal(host.pendingReconnects.size,0);
  host.state=null;await assert.doesNotReject(()=>host.receiveReconnect(9,{type:'identity-open',cupId,publicKey:identity.publicKey}));
});

test('automatic return notice accepts only the current host and never opens a prompt',async()=>{
 const {Controller}=await import('../.research/test-src/controller.ts');
 const Cup=await import('../.research/test-src/cup.ts');
 const c=new Controller(()=>{});c.selfId=9;c.state=Cup.newCup();c.state.roster=[{id:2,name:'Original'}];
 const notice={type:'reconnect-queued',cupId:c.state.id,racerId:2};
 await c.receiveReconnect(8,notice);assert.equal(c.reconnectPending,false);
 await c.receiveReconnect(0,{...notice,cupId:'ended'});assert.equal(c.reconnectPending,false);
 await c.receiveReconnect(0,notice);assert.equal(c.reconnectPending,true);assert.equal(c.panelRequest.open,false);
 c.requestPanel(true);await c.receiveReconnect(0,notice);assert.equal(c.panelRequest.open,true,'repeated notices must not close a manually opened panel');
 c.connection={};c.native={};c.state.roster[0].id=9;c.syncReconnect();assert.equal(c.reconnectPending,false);
 c.state=null;await c.receiveReconnect(0,notice);assert.equal(c.reconnectPending,false);
});
