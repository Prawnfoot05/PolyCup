import {test} from 'node:test';import assert from 'node:assert/strict';
import {applyGarageIdentity} from '../src/controller.ts';
test('race handoff uses garage names and flags without changing ranked player bindings',()=>{
 const rank={tier:'gold',rating:12000,gm_position:null,provisional:false};
 const state={roster:[{id:8,name:'Account Alice',rank},{id:3,name:'Account Bob'},{id:11,name:'Disconnected Racer'}]};
 applyGarageIdentity(state,[{id:3,nickname:'Garage B',countryCode:'RO'},{id:8,nickname:'Garage A',countryCode:'BG'},{id:99,nickname:'Account Alice',countryCode:'US'}]);
 assert.deepEqual(state.roster,[{id:8,name:'Garage A',rank,countryCode:'bg'},{id:3,name:'Garage B',countryCode:'ro'},{id:11,name:'Disconnected Racer'}]);
});
