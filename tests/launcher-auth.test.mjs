import test from 'node:test';import assert from 'node:assert/strict';import {desktopAuth,isDiscordSignInUrl}from'../src/desktop-auth.ts';
const url='https://wqaipijoqqqrwyivajjg.supabase.co/auth/v1/authorize?provider=discord&code_challenge=test';
test('PolyLauncher uses its browser bridge, without pretending to support automatic return',async()=>{
 const oldWindow=globalThis.window,oldLocation=globalThis.location;const sent=[];
 try{
  globalThis.location={protocol:'http:',hostname:'127.0.0.1'};
  globalThis.window={parent:{postMessage:(...args)=>sent.push(args)},electron:{getHelperPort:()=>null,getArgv:()=>[]}};
  const adapter=desktopAuth();assert.equal(adapter.requiresReturnCode,true);assert.equal(adapter.startReturn,undefined);await adapter.openDiscord(url);assert.deepEqual(sent,[[{type:'open-url',url},'*']]);
  await assert.rejects(adapter.openDiscord('javascript:alert(1)'));await assert.rejects(adapter.openDiscord('https://example.com'));assert.equal(sent.length,1);
  window.electron.getHelperPort=()=>1234;assert.equal(desktopAuth(),undefined);
  window.electron.getHelperPort=()=>null;location.hostname='example.com';assert.equal(desktopAuth(),undefined);
  location.hostname='127.0.0.1';window.parent=window;assert.equal(desktopAuth(),undefined);
  const native={openDiscord:async()=>{}};window.polycupDesktop=native;assert.equal(desktopAuth(),native);
 }finally{globalThis.window=oldWindow;globalThis.location=oldLocation;}
});
test('launcher authorization URLs are restricted to the configured Discord entry point',()=>{
 assert.equal(isDiscordSignInUrl(url),true);
 for(const other of [url.replace('https:','http:'),url.replace('provider=discord','provider=github'),url.replace('/authorize','/callback'),url.replace('https://','https://user:password@'),'file:///C:/example'])assert.equal(isDiscordSignInUrl(other),false);
});
