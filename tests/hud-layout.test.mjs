import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeClearance, visibleHudRect } from '../.research/test-src/hud-layout.ts';

const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

test('top instruments clear the leaderboard even when the toolbar is at the bottom', () => {
  const obstacles = [rect(0, 0, 134, 54), rect(252, 0, 481, 78.3), rect(481, 0, 710, 90),
    rect(0, 616, 160, 704), rect(0, 703, 891, 764)];
  assert.deepEqual(edgeClearance({ left: 0, right: 420 }, obstacles, 764), { top: 87, bottom: 156 });
});

test('spectator controls clear only the bottom toolbar pieces in their lane', () => {
  const obstacles = [rect(0, 616, 160, 704), rect(0, 703, 891, 764)];
  assert.deepEqual(edgeClearance({ left: 386, right: 806 }, obstacles, 764), { top: 0, bottom: 69 });
  assert.deepEqual(edgeClearance({ left: 987, right: 1183 }, obstacles, 764), { top: 0, bottom: 0 });
});

test('mixed HUD positions reserve both edges without treating empty timer space as occupied', () => {
  const obstacles = [rect(0, 0, 134, 54), rect(481, 675, 710, 764), rect(1038, 0, 1191, 54)];
  assert.deepEqual(edgeClearance({ left: 0, right: 420 }, obstacles, 764), { top: 62, bottom: 0 });
  assert.deepEqual(edgeClearance({ left: 386, right: 806 }, obstacles, 764), { top: 0, bottom: 97 });
  assert.deepEqual(edgeClearance({ left: 0, right: 420 }, [], 764), { top: 0, bottom: 0 });
});

test('a compact PB card clears the spectator dock after the bottom toolbar raises it', () => {
  const obstacles = [rect(0, 557, 649, 600), rect(190, 503, 610, 547)];
  assert.deepEqual(edgeClearance({ left: 596, right: 792 }, obstacles, 600), { top: 0, bottom: 105 });
});

const element = (style = {}, parentElement = null, visible = false) => ({
  style: { display: 'block', visibility: 'visible', opacity: '1', ...style }, parentElement,
  classList: { contains: name => name === 'visible' && visible },
  getBoundingClientRect: () => rect(0, 0, 420, 60),
});
const styleOf = node => node.style;

test('hidden native ancestors release their space, including UI toggle and spectating', () => {
  for (const style of [{ display: 'none' }, { visibility: 'hidden' }, { opacity: '0' }]) {
    assert.equal(visibleHudRect(element({}, element(style)), styleOf), null);
  }
  const hidden = element(); hidden.hidden = true;
  assert.equal(visibleHudRect(element({}, hidden), styleOf), null);
  const shadowChild = element(); shadowChild.getRootNode = () => ({ host: hidden });
  assert.equal(visibleHudRect(shadowChild, styleOf), null);
});

test('toolbar space is reserved throughout fade-in and fade-out', () => {
  assert.ok(visibleHudRect(element({}, element({ opacity: '0' }, null, true)), styleOf));
  assert.ok(visibleHudRect(element({}, element({ opacity: '.5' })), styleOf));
  assert.equal(visibleHudRect(element({}, element({ opacity: '0' })), styleOf), null);
});
