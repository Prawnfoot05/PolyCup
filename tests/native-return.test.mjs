import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['src/native-cup-menu.ts'],bundle:true,write:false,format:'esm',platform:'node',loader:{'.svg':'text'}});
const {registerCupMenu}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const hooks=[];registerCupMenu({polyVersion:'0.6.3',registerGlobalMixin:hook=>hooks.push(hook)},'insert');
const source=hooks.find(h=>h.token==='ee = 0;').func;
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
function fixture(){
 const listeners=new Map();let returning=false,created=0;
 const old={},states=new WeakMap([[old,{multiplayerConnection:{}}]]);
 const context={window:{addEventListener:(name,fn)=>listeners.set(name,fn)},document:{body:{dataset:{polycupNativeRace:'old'}}},
  performance,crypto,setTimeout:(fn)=>setTimeout(fn,1),clearTimeout,console,
  o:{isTransitioning:false},$ :old,Za:states,t:{hasLoaded:()=>true},k:{},T:{},S:{},
  K(){returning=true;context.o.isTransitioning=true;},
  ii:class{constructor(){created++;}startNewSessionImmediate(){return 1;}dispose(){}},
  J(a,b,c,d,session){context.$={};states.set(context.$,session);}
 };
 vm.runInNewContext(source,context);
 return {listeners,context,get returning(){return returning;},get created(){return created;},
  finishReturn(){context.$={};context.o.isTransitioning=false;},
  request(){const results=[];const request={mode:'host',track:{trackData:{hasStartingPoint:()=>true},trackMetadata:{}},complete:(...args)=>results.push(args)};return {request,results};}};
}
test('native rejoin waits until the previous menu transition has disposed the old race',async()=>{
 const f=fixture();f.listeners.get('polycup-return-menu')();await pause();assert.ok(f.returning);
 const {request,results}=f.request();const launch=f.listeners.get('polycup-start-native-race')({detail:request});
 await pause();assert.equal(results.length,0);assert.equal(f.created,0);
 f.finishReturn();await launch;assert.equal(results.length,1);assert.equal(results[0][0],null);assert.equal(f.created,1);
});
test('cancelling rejoin during menu return never starts a new connection',async()=>{
 const f=fixture();f.listeners.get('polycup-return-menu')();await pause();
 const {request,results}=f.request();const launch=f.listeners.get('polycup-start-native-race')({detail:request});
 request.cancel();f.finishReturn();await launch;assert.equal(f.created,0);assert.match(results[0][0],/cancelled/);
});
test('an unrelated active multiplayer game still prevents a Cup connection',async()=>{
 const f=fixture();const {request,results}=f.request();await f.listeners.get('polycup-start-native-race')({detail:request});
 assert.equal(f.created,0);assert.match(results[0][0],/Leave your current/);
});
