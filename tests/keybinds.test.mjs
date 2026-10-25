import test from 'node:test';
import assert from 'node:assert/strict';
import { registerReadyKeybind } from '../src/keybinds.ts';

test('PML bindings ignore early keys, preserve rebinding and pass the original event', () => {
  const saved = globalThis.KeyboardEvent;
  class Key extends Event { constructor(type, init = {}) { super(type, { cancelable: true }); Object.assign(this, init); } }
  globalThis.KeyboardEvent = Key;
  try {
    const target = new EventTarget(), matched = [];
    let binding = 'KeyY', checks = 0;
    const pml = { registerKeybind(label, id, event, primary, secondary, callback) {
      assert.equal(primary, 'KeyY'); assert.equal(secondary, null);
      target.addEventListener(event, e => {
        if (pml.settingClass.checkKeyBinding(e, id)) callback(e);
      });
    } };
    registerReadyKeybind(pml, 'Chat', 'Chat', 'KeyY', event => { matched.push(event); event.preventDefault(); }, target);
    target.dispatchEvent(new Key('keydown', { code: 'KeyY' }));
    assert.equal(matched.length, 0);
    pml.settingClass = { checkKeyBinding(event) { checks++; return event.code === binding; } };
    const original = new Key('keydown', { code: 'KeyY', repeat: true, ctrlKey: true });
    target.dispatchEvent(original);
    assert.equal(matched[0], original); assert.equal(original.defaultPrevented, true);
    assert.equal(matched[0].target, target); assert.equal(matched[0].ctrlKey, true);
    binding = 'KeyT';
    target.dispatchEvent(new Key('keydown', { code: 'KeyY' }));
    target.dispatchEvent(new Key('keydown', { code: 'KeyT' }));
    assert.equal(matched.length, 2); assert.equal(checks, 3);
    target.dispatchEvent(new Key('polycup-keydown-Chat', { code: 'KeyT' }));
    assert.equal(matched.length, 2);
    pml.settingClass = undefined;
    target.dispatchEvent(new Key('keydown', { code: 'KeyT' }));
    assert.equal(matched.length, 2);
  } finally { globalThis.KeyboardEvent = saved; }
});
