import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionQuality} from '../.research/test-src/connection-quality.ts';
test('connection colours ignore threshold flutter and require sustained movement in either direction',()=>{
 const q=new ConnectionQuality();assert.equal(q.read(1,99,0),'good');assert.equal(q.read(1,101,1000),'good');assert.equal(q.read(1,109,2000),'good');
 assert.equal(q.read(1,130,2100),'good');assert.equal(q.read(1,130,2800),'good');assert.equal(q.read(1,130,2850),'fair');
 assert.equal(q.read(1,95,4000),'fair');assert.equal(q.read(1,80,4100),'fair');assert.equal(q.read(1,80,4850),'good');
 assert.equal(q.read(1,450,5000),'good');assert.equal(q.read(1,450,5750),'poor');assert.equal(q.read(1,195,6500),'poor');
 assert.equal(q.read(1,180,6600),'poor');assert.equal(q.read(1,180,7350),'fair');
});
test('a brief spike does not change colour; unknown and departed peers discard previous readings',()=>{
 const q=new ConnectionQuality();q.read(1,30,0);q.read(1,400,100);assert.equal(q.read(1,30,500),'good');assert.equal(q.read(1,null,1000),'unknown');assert.equal(q.read(1,400,1100),'poor');q.retain(new Set());assert.equal(q.read(1,20,1200),'good');
});
