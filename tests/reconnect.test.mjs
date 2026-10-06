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

test('host recovery messages require ownership and a live Cup; accepting restores the slot without host interaction',async()=>{
  const {Controller}=await import('../.research/test-src/controller.ts');
  const Cup=await import('../.research/test-src/cup.ts');
  const host=new Controller(()=>{});host.isHost=true;host.selfId=1;host.connection={};
  host.state=Cup.newCup('Reconnect');host.state.phase='between-rounds';
  host.state.roster=[{id:2,name:'Anonymous'}];
  host.lobby=[{id:1,isSelf:true,nickname:'Host'},{id:2,nickname:'Anonymous'}];host.hello=new Set([2,9,8]);
  host.transport.has=()=>true;host.save=()=>{};host.broadcast=()=>{};
  const replies=[];host.transport.send=(id,m)=>{replies.push({id,...m});return true;};
  const identity=await profileIdentity('test-profile-A',host.state.id);
  const cupId=host.state.id;
  const register=async id=>{
    await host.receiveReconnect(id,{type:'identity-open',cupId,publicKey:identity.publicKey});
    const challenge=replies.at(-1);
    await host.receiveReconnect(id,{type:'identity-proof',cupId,nonce:challenge.nonce,signature:await identity.sign(challenge.nonce)});
  };
  await register(2);
  host.lobby=[{id:1,isSelf:true,nickname:'Host'},{id:9,nickname:'Renamed'},{id:8,nickname:'Anonymous'}];
  host.syncReconnect();await register(9);
  assert.equal(replies.at(-1).type,'reconnect-offer');assert.equal(replies.at(-1).racerId,2);
  await host.receiveReconnect(8,{type:'reconnect-accept',cupId,racerId:2});assert.equal(host.state.roster[0].id,2);
  host.state.runtime={id:'live'};
  await host.receiveReconnect(9,{type:'reconnect-accept',cupId,racerId:2});assert.equal(host.state.roster[0].id,2);
  host.state.runtime=null;
  await host.receiveReconnect(9,{type:'reconnect-accept',cupId:'ended-cup',racerId:2});assert.equal(host.state.roster[0].id,2);
  await host.receiveReconnect(9,{type:'reconnect-accept',cupId,racerId:2});
  assert.equal(host.state.roster[0].id,9);assert.equal(host.state.roster[0].name,'Renamed');
  host.state=null;
  await assert.doesNotReject(()=>host.receiveReconnect(9,{type:'reconnect-accept',cupId,racerId:2}));
});


test('returning client prompt accepts only current host offers and honors staying a spectator',async()=>{
 const {Controller}=await import('../.research/test-src/controller.ts');
 const Cup=await import('../.research/test-src/cup.ts');
 const c=new Controller(()=>{});c.selfId=9;c.state=Cup.newCup();c.state.roster=[{id:2,name:'Original'}];
 const offer={type:'reconnect-offer',cupId:c.state.id,racerId:2};
 await c.receiveReconnect(8,offer);assert.equal(c.reconnectOffer,null);
 await c.receiveReconnect(0,{...offer,cupId:'ended'});assert.equal(c.reconnectOffer,null);
 await c.receiveReconnect(0,offer);assert.equal(c.reconnectOffer,2);assert.equal(c.panelRequest.open,true);
 let sent;c.transport.send=(id,message)=>{sent={id,...message};return true;};
 c.acceptReconnect();assert.equal(sent.type,'reconnect-accept');assert.equal(sent.racerId,2);
 c.declineReconnect();await c.receiveReconnect(0,offer);assert.equal(c.reconnectOffer,null);
 c.state=null;await c.receiveReconnect(0,offer);assert.equal(c.reconnectOffer,null);
});
