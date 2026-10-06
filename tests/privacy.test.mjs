import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import ts from 'typescript';
import { Controller } from '../src/controller.ts';
import { CameraBuffer } from '../src/spectator.ts';
import { InputCapture } from '../src/inputs.ts';

test('production classes use runtime-private fields; boot queries need no active Cup', () => {
  const controller = new Controller(() => {});
  assert.equal(controller.state, null);
  assert.equal(controller.canSpectate(), false);
  assert.deepEqual(Object.keys(controller), []);
  assert.throws(() => { controller.state = {}; }, TypeError);
  for (const instance of [new CameraBuffer(), new InputCapture({stage:'race'})]) {
    assert.deepEqual(Object.keys(instance), []);
    assert.equal('events' in instance, false);
    assert.equal('frames' in instance, false);
  }
});

test('every production class field is private, with no fixture accessors in source', async () => {
  for (const file of await readdir('src')) {
    if (!file.endsWith('.ts')) continue;
    const tree = ts.createSourceFile(file, await readFile(`src/${file}`, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = node => {
      if (ts.isPropertyDeclaration(node)) assert.ok(ts.isPrivateIdentifier(node.name), `${file}: ${node.name.getText(tree)}`);
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
});

test('PML hooks override inherited own no-ops without exposing controller or UI', async () => {
  const source = await readFile('src/main.ts', 'utf8');
  const stub = `const { PolyMod, MixinType } = {
    PolyMod: class { constructor() { this.preInit=()=>{};this.init=()=>{};this.postInit=()=>{};this.onGameLoad=()=>{}; } },
    MixinType: {INSERT:'insert'}
  };`;
  const start = source.indexOf('const { PolyMod, MixinType }');
  const end = source.indexOf('class PolyCup', start);
  const bundle = await build({stdin:{contents:source.slice(0,start)+stub+source.slice(end),resolveDir:'src',loader:'ts'},
    bundle:true,write:false,format:'esm',target:'es2022',loader:{'.css':'text','.svg':'text'}});
  const { polyMod } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  assert.equal('controller' in polyMod, false);
  assert.equal('ui' in polyMod, false);
  let registered;
  const hook = polyMod.preInit;
  hook({registerGlobalMixin:mixin=>{registered=mixin;}});
  assert.equal(registered.type, 'insert');
  assert.match(registered.token, /visible/);
  assert.equal(Object.getOwnPropertyDescriptor(polyMod,'preInit').writable, false);
});
