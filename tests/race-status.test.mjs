import test from 'node:test';
import assert from 'node:assert/strict';
import { downtimeLabel, roundSeconds } from '../src/race-status.ts';
import { Controller } from '../.research/test-src/controller.ts';

test('downtime labels never obscure racing, the start countdown, or winner presentation', () => {
  for (const phase of [undefined,'racing','countdown','complete']) assert.equal(downtimeLabel(phase),'');
  assert.equal(downtimeLabel('warmup'),'Warmup');
  assert.equal(downtimeLabel('loading'),'Changing track...');
  assert.equal(downtimeLabel('loading',false,true),'Preparing next round...');
  assert.equal(downtimeLabel('between-rounds',true),'Waiting for reconnect...');
  assert.equal(downtimeLabel('between-rounds'),'Waiting for next round...');
});
test('round countdown follows the synchronized deadline, never a stale phase or warmup timer', () => {
  const s={phase:'racing',runtime:{deadline:15000}};
  assert.equal(roundSeconds(s,10001),5);
  assert.equal(roundSeconds(s,16000),0);
  for(const phase of ['warmup','countdown','loading','between-rounds','complete'])
    assert.equal(roundSeconds({...s,phase},10000),null);
  assert.equal(roundSeconds({...s,runtime:{deadline:null}},10000),null);
  assert.equal(roundSeconds(null,10000),null);
});
test('automatic rounds default on and can be explicitly disabled', () => {
  const c=new Controller(()=>{});c.isHost=true;c.connection={};
  assert.equal(c.auto,true);c.toggleAutomaticRounds();assert.equal(c.auto,false);
});
