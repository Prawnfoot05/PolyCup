import test from 'node:test';
import assert from 'node:assert/strict';
import {lobbyView} from '../.research/test-src/lobby.ts';
const state=()=>({roster:[{id:1,name:'Kiki'},{id:2,name:'Nova'}],tracks:[{id:'a',name:'Summer 1'}],picks:{},draft:{stage:'roster',order:[1,2],bans:{}}});
test('lobby follows roster, current ban and pick completion without navigation',()=>{
 const s=state();
 assert.equal(lobbyView(s,1).mode,'join');
 s.draft.stage='bans';
 assert.equal(lobbyView(s,1).title,'Your ban');
 assert.equal(lobbyView(s,2).title,'Kiki’s ban');
 s.draft.bans[1]={id:'x',name:'Summer 3'};
 assert.equal(lobbyView(s,2).title,'Your ban');
 s.draft.stage='picks';
 assert.equal(lobbyView(s,1).mode,'pick');
 s.picks[1]='a';
 assert.equal(lobbyView(s,1).mode,'selected');
 assert.equal(lobbyView(s,1,true).mode,'pick');
 assert.equal(lobbyView(s,1).ready,1);
 assert.equal(lobbyView(s,99).mode,'spectator');
});
test('legacy saves and removed picks keep an actionable lobby',()=>{
 const s=state();delete s.draft;
 assert.equal(lobbyView(s,1).mode,'pick');
 s.picks[1]='missing';
 assert.equal(lobbyView(s,1).mode,'pick');
 s.picks[1]='a';
 assert.equal(lobbyView(s,1).pick.name,'Summer 1');
});
test('country flags use only the native player-selected country code',async()=>{
 const {countryFlag}=await import('../.research/test-src/lobby.ts');
 assert.equal(countryFlag('RO'),'images/countries/ro.svg');
 assert.equal(countryFlag('np'),'images/countries/np.svg');
 for(const value of [null,undefined,'','../ro','Romania',42])assert.equal(countryFlag(value),null);
});
