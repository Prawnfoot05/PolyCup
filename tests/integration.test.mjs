import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller, validSnapshot } from '../.research/test-src/controller.ts';
import * as Cup from '../.research/test-src/cup.ts';
import { CameraBuffer, validPose, renderCarPose } from '../.research/test-src/spectator.ts';
import { CupTransport, connectNative, beforeGameRender, registerCarVisibility } from '../.research/test-src/native.ts';
import { pack, unpack } from '../scripts/asar.mjs';
function race() {
  const s = Cup.newCup();
  for (const i of [1,3,5,7]) { Cup.addPlayer(s,i,`P${i}`); Cup.chooseTrack(s,i,{id:String((i%3)+1).repeat(64),name:`T${i}`}); }
  Cup.lockRegistration(s);
  Cup.beginRound(s); s.runtime.sessionId = 9; s.phase = 'countdown'; Cup.startRace(s, Date.now() - 10000); return s;
}
const pose = (at = 1000) => ({ sessionId: 9, at, position: [0,1,2], quaternion: [0,0,0,1], fov: 75, frames: 1000, speed: 120,
  carPosition: [0,0,0], carQuaternion: [0,0,0,1], view: 0 });

test('native presentation is reversible and scoped to the current game and ended-session backdrop', () => {
  class Game { update(){} dispose(){} } class Library {}
  const node=()=>({classList:{values:new Set(),toggle(key,on){if(on)this.values.add(key);else this.values.delete(key);}}});
  const game={}, other={}, ui=node(), otherUI=node(), backdrop=node(), endScreen={};
  const _a=new WeakMap([[game,{element:ui}],[other,{element:otherUI}]]), ss=new WeakMap([[game,false]]);
  const Oa=new WeakMap(), Hr=new WeakMap([[endScreen,backdrop]]);
  let visible=false,focused=false; const cursor={isCursorHidden:true};
  const Na=new WeakMap([[game,{setVisible:v=>visible=v,hasFocus:()=>focused}]]),fa=new WeakMap([[game,cursor]]);
  ui.querySelector=()=>null;
  const pml={polyVersion:'0.6.3',getFromPolyTrack:code=>Function('ii','vc','Is','du','_a','ss','Oa','Hr','Na','fa',
    `let bs=()=>{},Ss=()=>{};return ${code}`)(class{},class{},Game,Library,_a,ss,Oa,Hr,Na,fa)};
  const native=connectNative(pml,{}), classes=n=>[...n.classList.values];
  native.presentation(game,true,true); assert.deepEqual(classes(ui),['polycup-watching']);
  assert.equal(visible,false);
  cursor.isCursorHidden=false;native.presentation(game,true,true);assert.equal(visible,true);
  cursor.isCursorHidden=true;visible=false;native.presentation(game,true,true);assert.equal(visible,false);
  focused=true;native.presentation(game,true,true);assert.equal(visible,true);
  focused=false;ui.querySelector=()=>({});native.presentation(game,true,true);assert.equal(visible,true);
  native.presentation(game,true,false); assert.deepEqual(classes(ui),[]);
  ss.set(game,true); Oa.set(game,endScreen);
  native.presentation(game,true,true);
  assert.deepEqual(classes(ui),['polycup-session-ended']); assert.deepEqual(classes(backdrop),['polycup-session-ended']);
  native.presentation(game,false,false); assert.deepEqual(classes(ui),[]); assert.deepEqual(classes(backdrop),[]);
  assert.deepEqual(classes(otherUI),[]); assert.equal(ss.get(game),true); assert.equal(Oa.get(game),endScreen);
});

test('native restart detection follows both rebound slots, preserves checkpoint priority and ignores menus or finished cars', () => {
  class Game { update(){} dispose(){} } class Library {}
  const game={}, ua=new WeakMap(),fs=new WeakMap(),Xa=new WeakMap(), ge={A:{VehicleStartReset:5,VehicleCheckpointReset:4}};
  const keys=new Map([[5,['KeyT','Backspace']],[4,['KeyR','Enter']]]);
  let blocked=false,paused=false,started=true,finished=false;
  ua.set(game,{checkKeyBinding:(e,id)=>keys.get(id).includes(e.code)});fs.set(game,{isEnabled:false});
  Xa.set(game,{hasStarted:()=>started,hasFinished:()=>finished});
  const pml={polyVersion:'0.6.3',getFromPolyTrack:code=>Function('ii','vc','Is','du','ua','fs','Xa','ge','isBlocked','isPaused',
    `let bs=isBlocked,Ss=()=>{},Ps=()=>!isPaused();return ${code}`)(class{},class{},Game,Library,ua,fs,Xa,ge,()=>blocked,()=>paused)};
  const native=connectNative(pml,{shouldBlock:()=>false});
  const detects=code=>native.restartPressed(game,{code});
  assert.equal(detects('KeyT'),true); assert.equal(detects('Backspace'),true);
  assert.equal(detects('KeyR'),false); assert.equal(detects('Enter'),false);
  keys.set(5,['KeyY','Delete']); assert.equal(detects('KeyT'),false); assert.equal(detects('KeyY'),true); assert.equal(detects('Delete'),true);
  keys.set(4,['KeyY']);assert.equal(detects('KeyY'),false);
  blocked=true; assert.equal(detects('Delete'),false); blocked=false;
  paused=true; assert.equal(detects('Delete'),false); paused=false;
  started=false; assert.equal(detects('Delete'),false); started=true;
  finished=true; assert.equal(detects('Delete'),false); finished=false;
  fs.get(game).isEnabled=true; assert.equal(detects('Delete'),false);
});

test('native Game.update applies Cup transforms and visibility before the draw, after native resets', () => {
  const events=[], model={visible:true,x:0}, camera={x:0};
  const renderer={update(){events.push('draw');assert.equal(model.visible,false);assert.equal(model.x,25);assert.equal(camera.x,30);}};
  const originalDraw=renderer.update;
  class Game { update(){events.push('native');model.visible=true;model.x=50;renderer.update();return 'complete';} dispose(){} }
  class Library {}
  const game=new Game(),la=new WeakMap([[game,renderer]]);
  const pml={polyVersion:'0.6.3',getFromPolyTrack:code=>Function('ii','vc','Is','du','la',`let bs=()=>{},Ss=()=>{};return ${code}`)(class{},class{},Game,Library,la)};
  connectNative(pml,{observeGame(){events.push('observe');},beforeRender(){events.push('prepare');model.visible=false;model.x=25;camera.x=30;}});
  for(let i=0;i<3;i++) assert.equal(game.update(),'complete');
  assert.deepEqual(events,Array.from({length:3},()=>['observe','native','prepare','draw']).flat());
  assert.equal(renderer.update,originalDraw);
});

test('temporary renderer hooks restore own and inherited methods when preparing or drawing fails', () => {
  for(const own of [true,false]) for(const fail of ['prepare','draw']) {
    const original=function(){if(fail==='draw')throw new Error('draw failure');};
    const renderer=own?{update:original}:Object.create({update:original});
    assert.throws(()=>beforeGameRender(renderer,()=>{if(fail==='prepare')throw new Error('prepare failure');},()=>renderer.update()),new RegExp(fail+' failure'));
    assert.equal(renderer.update,original);assert.equal(Object.hasOwn(renderer,'update'),own);
  }
});

test('rapid full loops retain camera distance and framing while preserving driver zoom and FOV', () => {
  const b=new CameraBuffer();
  // Two complete loops in 800 ms, with translation and a gradual driver zoom.
  for(let at=1000;at<=1800;at+=50){
    const angle=(at-1000)*Math.PI/200, distance=6+(at-1000)/800;
    const carPosition=[(at-1000)/20,8*Math.cos(angle),8*Math.sin(angle)];
    b.push({...pose(at),frames:at,carPosition,position:[carPosition[0],carPosition[1]-distance*Math.sin(angle),carPosition[2]+distance*Math.cos(angle)],
      quaternion:[Math.sin(angle/2),0,0,Math.cos(angle/2)],carQuaternion:[Math.sin(angle/2),0,0,Math.cos(angle/2)],fov:75+(at-1000)/80});
  }
  for(let at=1000;at<=1800;at+=5){
    const p=b.sample(at,9),delta=p.position.map((v,i)=>v-p.carPosition[i]),distance=6+(at-1000)/800;
    assert.ok(Math.abs(Math.hypot(...delta)-distance)<1e-9,`distance at ${at}`);
    const [x,,,w]=p.quaternion;
    assert.ok(Math.abs(delta[1]+distance*2*x*w)<1e-9,`vertical framing at ${at}`);
    assert.ok(Math.abs(delta[2]-distance*(1-2*x*x))<1e-9,`forward framing at ${at}`);
    assert.equal(p.fov,75+(at-1000)/80);
  }
});

test('near-unit native quaternions cannot scale the spectator camera offset', () => {
  const b=new CameraBuffer();
  b.push({...pose(1000),position:[0,0,6],quaternion:[0,0,0,.9999]});
  b.push({...pose(1100),position:[0,-6,0],quaternion:[Math.SQRT1_2*.9999,0,0,Math.SQRT1_2*.9999]});
  for(let at=1001;at<1100;at++){
    const p=b.sample(at,9);
    assert.ok(Math.abs(Math.hypot(...p.position)-6)<1e-9);
  }
});

test('leaving Cup POV restores the selected native camera and normal car volumes', () => {
  class Game { update(){} dispose(){} } class Library {}
  const game={}, Xa=new WeakMap(), fs=new WeakMap(), la=new WeakMap(), ua=new WeakMap(), as=new WeakMap(), vs=new WeakMap();
  let orbit=true, finished=false, camera;
  const own={cameraOrbit:{name:'orbit'},cameraCockpit:{name:'cockpit'},hasFinished:()=>finished,audioVolume:0};
  const spectator={isEnabled:true}, remote={car:{audioVolume:1}};
  Xa.set(game,own);fs.set(game,spectator);la.set(game,{setCamera:value=>{camera=value;}});
  ua.set(game,{getSettingBoolean:()=>orbit});as.set(game,new Map([[2,remote]]));vs.set(game,.4);
  const pml={polyVersion:'0.6.3',getFromPolyTrack:code=>Function('ii','vc','Is','du','Xa','fs','la','ua','as','vs','P',
    `let bs=()=>{},Ss=()=>{};return ${code}`)(class{},class{},Game,Library,Xa,fs,la,ua,as,vs,{A:{DefaultCameraMode:3}})};
  const native=connectNative(pml,{});
  for(const [setting,hasFinished,expected] of [[true,false,'orbit'],[false,false,'cockpit'],[false,true,'orbit']]) {
    orbit=setting;finished=hasFinished;spectator.isEnabled=true;own.audioVolume=0;remote.car.audioVolume=1;
    native.release(game);
    assert.equal(camera.name,expected);assert.equal(spectator.isEnabled,false);
    assert.equal(own.audioVolume,1);assert.equal(remote.car.audioVolume,.4);
  }
});
test('library selection retains an exportable custom track for transfer and autosave', async () => {
  const c = new Controller(() => {}); c.isHost = true; c.connection = {}; c.state = Cup.newCup(); c.selfId=1; Cup.addPlayer(c.state,1,'Host'); c.broadcast = () => {};
  const id = 'a'.repeat(64), metadata = { name: 'Locally saved track' };
  const track = { trackMetadata: metadata, trackData: { hasStartingPoint: () => true, getId: () => id,
    toExportString: m => { assert.equal(m, metadata); return 'complete-custom-track'; } } };
  c.native = { parse: code => { assert.equal(code, 'complete-custom-track'); return track; } };
  await c.addLibraryTrack({ load: async () => track });
  assert.equal(c.state.tracks[0].id, id); assert.equal(c.tracks.get(id).code, 'complete-custom-track');
});
test('pending track selection cannot add a track to a replaced tournament', async () => {
  const c = new Controller(() => {}); c.isHost = true; c.connection = {}; c.state = Cup.newCup();
  let finish; const pending = c.addLibraryTrack({ load: () => new Promise(resolve => { finish = resolve; }) });
  c.state = Cup.newCup('Another cup'); finish({});
  await assert.rejects(pending, /tournament changed/); assert.equal(c.state.tracks.length, 0);
});
test('snapshot parser rejects malformed nested data while accepting every engine phase', () => {
  assert.ok(validSnapshot(Cup.newCup()));
  const s = race(); assert.ok(validSnapshot(s)); assert.ok(validSnapshot(Cup.publicState(s)));
  for (const id of Cup.activeIds(s)) Cup.recordFinish(s, id, 1000, Date.now());
  Cup.completeRound(s); assert.ok(validSnapshot(s));
  const broken = structuredClone(s); broken.matches[0].scores = null; assert.equal(validSnapshot(broken), false);
  broken.matches = [null]; assert.equal(validSnapshot(broken), false);
});
test('restored identities cannot collide with another saved racer or silently claim new lobby IDs', () => {
  const s = race(); Cup.recordFinish(s, 1, 1000, Date.now()); Cup.completeRound(s);
  Cup.detachIdentities(s); assert.deepEqual(s.roster.map(p => p.id), [-1,-2,-3,-4]);
  Cup.rebindPlayer(s, -2, 1, 'Reconnected 2'); Cup.rebindPlayer(s, -1, 2, 'Reconnected 1');
  assert.equal(s.matches[0].scores[2], 10); assert.equal(s.matches[0].roundsLog[0].finishes[2], 1000);
  Cup.undoRound(s); assert.equal(s.matches[0].scores[2], 0); assert.ok(validSnapshot(s));
});
test('finish reports bind to the current native session and round, ignoring late warmup/previous-round data', () => {
  const c = new Controller(() => {}); c.isHost = true; c.state = race();
  c.broadcast = () => {};
  const m = { roundId: c.state.runtime.id, sessionId: 9, frames: 5000, checkpoint: 2000 };
  c.receiveFinish(1, { ...m, roundId: 'old-round' }); c.receiveFinish(1, { ...m, sessionId: 8 });
  c.receiveFinish(2, m); assert.deepEqual(c.state.runtime.finishes, {});
  c.receiveFinish(1, m); assert.equal(c.state.runtime.finishes[1], 5000); assert.equal(c.state.runtime.checkpoints[1], 2000);
  c.receiveFinish(1, { ...m, frames: 4000 }); assert.equal(c.state.runtime.finishes[1], 5000);
});
test('disconnect choices produce DNF or a void, and pause the schedule without changing automatic preference', () => {
  for (const policy of ['dnf','void']) {
    const c = new Controller(() => {}); c.state = race(); c.state.disconnectPolicy = policy;
    c.auto = true; c.lobby = [1,3,5].map(id => ({ id })); c.checkDisconnects();
    assert.equal(c.auto, true); assert.equal(c.nextAuto, null);
    if (policy === 'dnf') assert.deepEqual(c.state.runtime.dnfs, [7]);
    else { assert.equal(c.state.runtime, null); assert.equal(c.state.phase, 'between-rounds'); }
  }
});
test('camera samples interpolate, reject stale sessions and invalid packets, and cut on respawn', () => {
  const b = new CameraBuffer(); assert.ok(b.push(pose()));
  assert.ok(b.push({ ...pose(1100), position: [10,1,2], carPosition:[10,0,0], frames: 1100, quaternion: [0,0,0,-1] }));
  assert.deepEqual(b.sample(1050,9).position, [5,1,2]); assert.equal(b.sample(1050,9).frames,1050);
  assert.deepEqual(b.playback(1300,9,0).position,[5,1,2]);
  assert.equal(b.playback(3000,9,1700),null);
  assert.equal(b.sample(1050,8),null); assert.equal(b.sample(3000,9),null);
  assert.equal(b.push(pose(1050)),false); assert.equal(validPose({ ...pose(), quaternion:[0,0,0,0] }),false);
  b.push({ ...pose(1200), frames: 10 }); assert.equal(b.frames.length,1);
});
test('spectators can cycle only active racers and a client cannot impersonate camera identity', () => {
  const c = new Controller(() => {}); c.state = race(); c.isHost = true; c.selfId = 8;
  c.info = { sessionId:9 }; c.lobby = [1,3,5,7,8].map(id => ({ id })); c.hello.add(3);
  c.selectWatch(1); c.cycleWatch(1); assert.equal(c.watchId,3);
  c.receiveCamera(3,{ type:'camera',racerId:1,pose:{...pose(),at:Date.now()} });
  assert.ok(c.cameraBuffers.has(3)); assert.equal(c.cameraBuffers.has(1),false);
  c.selfId=3; c.cycleWatch(1); assert.equal(c.watchId,3);
});

test('ghost filtering keeps the driver or watched racer, follows new cars, and restores native visibility on exit', () => {
  class Game { update(){} dispose(){} } class Library {}
  const Xa=new WeakMap(), as=new WeakMap(), game={};
  const car=()=>({visible:true,setVisible(value){this.visible=value;}}), own=car();
  const others=new Map([3,5,7,8].map(id=>[id,{car:car()}])); Xa.set(game,own);as.set(game,others);
  // Native overlap rules deliberately keep one idle lobby car invisible.
  const Cs=function(){for(const [id,r] of as.get(this)) r.car.setVisible(id!==8);};
  const pml={polyVersion:'0.6.3',getFromPolyTrack:code=>Function('ii','vc','Is','du','Xa','as','Cs',
    `let bs=()=>{},Ss=()=>{};const ss=new WeakMap(),_a=new WeakMap(),Oa=new WeakMap(),Hr=new WeakMap(),Na={get:()=>({setVisible(){},hasFocus:()=>false})},fa={get:()=>({isCursorHidden:false})};return ${code}`)(class{},class{},Game,Library,Xa,as,Cs)};
  const c=new Controller(()=>{}); c.native=connectNative(pml,c);c.game=game;c.connection={};c.state=race();c.selfId=1;c.isHost=true;
  c.info={sessionId:9,spectator:{isEnabled:true}};c.lobby=[1,3,5,7,8].map(id=>({id}));
  c.transport.broadcast=c.transport.send=c.cameraTransport.send=()=>{throw new Error('Visibility must not send race data');};
  const saved=JSON.stringify(c.state);
  c.beforeRender(game);assert.equal(own.visible,true);assert.equal(others.get(3).car.visible,true);
  c.toggleGhosts();c.beforeRender(game);assert.equal(own.visible,true);assert.ok([...others.values()].every(r=>!r.car.visible));
  others.set(3,{car:car()});c.beforeRender(game);assert.equal(others.get(3).car.visible,false);
  c.toggleGhosts();c.beforeRender(game);assert.equal(others.get(3).car.visible,true);
  c.toggleGhosts();c.selfId=8;c.lastWatchPose=pose();c.native.camera=()=>pose();c.native.follow=()=>{};
  c.beforeRender(game);assert.equal(own.visible,false);assert.equal(c.watchId,1);
  c.cycleWatch(1);c.beforeRender(game);assert.equal(c.watchId,3);assert.equal(others.get(3).car.visible,true);assert.equal(others.get(5).car.visible,false);
  c.cycleWatch(1);c.beforeRender(game);assert.equal(others.get(3).car.visible,false);assert.equal(others.get(5).car.visible,true);
  assert.equal(JSON.stringify(c.state),saved);
  c.state=null;c.beforeRender(game);assert.equal(own.visible,true);assert.equal(others.get(3).car.visible,true);assert.equal(others.get(8).car.visible,false);
});
test('buffered POV stays monotonic under packet jitter, loss, and reordering with camera and car aligned', () => {
  const b = new CameraBuffer(), queue = [];
  for (let at = 0; at <= 3000; at += 50) {
    if ([7, 19, 20].includes(at / 50)) continue;
    queue.push({ arrive: at + [30, 90, 45, 110, 20][at / 50 % 5], value: {
      ...pose(at), frames: at, position: [at / 10, 2, 5], carPosition: [at / 10, 0, 0] } });
  }
  queue.sort((a, b) => a.arrive - b.arrive);
  let previous = null, count = 0, maxStep = 0;
  for (let now = 0; now < 3000; now += 10) {
    while (queue[0]?.arrive <= now) b.push(queue.shift().value);
    const p = b.playback(now, 9, now);
    if (!p) continue;
    assert.equal(p.position[0], p.carPosition[0]);
    assert.ok(Math.hypot(...p.position.map((v, i) => v-p.carPosition[i]-[0,2,5][i]))<1e-9);
    if (previous !== null && now > 300) {
      const step = p.position[0] - previous;
      assert.ok(step >= -1e-9, `camera rewound at ${now}`);
      assert.ok(step <= 1.11, `camera jumped ${step} at ${now}`);
      maxStep = Math.max(maxStep, step); count++;
    }
    previous = p.position[0];
  }
  assert.ok(count > 200); assert.ok(maxStep > .9);
});
test('camera loss holds position, resumes smoothly, and a clock adjustment cannot rewind playback', () => {
  const b = new CameraBuffer();
  for (const at of [1000,1050,1100]) b.push({ ...pose(at), frames:at, position:[(at-1000)/10,0,0] });
  const xs = [];
  for (let now = 1340; now <= 1500; now += 10) xs.push(b.playback(now,9,now).position[0]);
  assert.equal(xs.at(-1),10); assert.ok(xs.every((x,i) => i === 0 || x >= xs[i-1]));
  b.push({ ...pose(1510), frames:1510, position:[51,0,0], carPosition:[51,0,0] });
  // A real teleport cuts at its timestamp, not through the scenery.
  assert.equal(b.sample(1400,9).position[0],10);
  const before = b.playback(1510,9,1510).at;
  assert.ok(b.playback(1480,9,1520).at >= before);
  assert.equal(b.playback(4000,9,4000),null);
  b.push({ ...pose(4010), frames:10, position:[0,0,0] });
  assert.equal(b.playback(4260,9,4260).position[0],0);
});
test('a newly watched stream fills the viewing buffer before advancing', () => {
  const b = new CameraBuffer();
  for(let now=1030;now<=1300;now+=10) {
    const at=now-30;
    if(at%50===0) b.push({...pose(at),frames:at,position:[at/10,0,0]});
    const p=b.playback(now,9,now);
    if(now<=1250) assert.equal(p.at,1000);
    else assert.equal(p.at,now-250);
  }
});
test('cockpit/chase switches cut together and malformed car transforms are rejected', () => {
  const b = new CameraBuffer(); b.push(pose(1000)); b.push({ ...pose(1100), view:1, position:[0,1,0] });
  assert.equal(b.sample(1099,9).view,0); assert.equal(b.sample(1100,9).view,1);
  assert.equal(validPose({ ...pose(), carPosition:[Infinity,0,0] }),false);
  assert.equal(validPose({ ...pose(), carQuaternion:[0,0,0,0] }),false);
  assert.equal(validPose({ ...pose(), view:3 }),false);
  assert.ok(JSON.stringify({protocol:1,type:'camera',racerId:1,pose:pose()}).length < 2000);
});
test('spectator redraw restores native getters and never changes car state, even on failure', () => {
  class Value {
    constructor(v) { this.value = v; }
    fromArray(v) { this.value = [...v]; return this; }
    clone() { return new Value([...this.value]); }
  }
  const native = { position:[9,0,0], quaternion:[0,0,0,1], frames:1500 };
  const prototype = { getPosition() { return new Value(native.position); }, getQuaternion() { return new Value(native.quaternion); } };
  const car = Object.create(prototype), calls = [];
  car.update = dt => calls.push({dt, position:car.getPosition().value, quaternion:car.getQuaternion().value});
  renderCarPose(car, { ...pose(), carPosition:[1,2,3] });
  assert.deepEqual(calls,[{dt:0,position:[1,2,3],quaternion:[0,0,0,1]}]);
  assert.equal(Object.hasOwn(car,'getPosition'),false);
  assert.equal(car.getPosition().value,native.position); assert.equal(native.frames,1500);
  car.update = () => { throw new Error('renderer failed'); };
  assert.throws(() => renderCarPose(car,pose()), /renderer failed/);
  assert.equal(car.getQuaternion,prototype.getQuaternion);
});
test('spectator playback uses the buffered stream independent of native car playback corrections', () => {
  const c = new Controller(() => {}); c.state=race(); c.isHost=true; c.selfId=8;
  c.game={}; c.info={sessionId:9}; c.lobby=[1,3,5,7,8].map(id=>({id})); c.watchId=1;
  c.now=()=>1300;
  c.now=()=>1030;
  c.bufferCamera(1,{...pose(1000), frames:1000, position:[0,0,0],carPosition:[0,0,0]});
  c.now=()=>1130;
  c.bufferCamera(1,{...pose(1100), frames:1100, position:[10,0,0],carPosition:[10,0,0]});
  c.now=()=>1300;
  let shown; c.native={visibility(){},follow(g,p,id){shown={p,id};},remoteFrame(){throw new Error('native timeline must not drive POV');}};
  c.beforeRender(c.game);
  assert.equal(shown.id,1); assert.equal(shown.p.position[0],5); assert.equal(shown.p.carPosition[0],5);
});
test('transport binds messages to native peer identity, drops oversized/flooded packets, and uses separate camera channel', () => {
  let opts, created=0, received=[]; const channels=[];
  const makeChannel=()=>{const ch={readyState:'open',bufferedAmount:0,close(){this.readyState='closed';},send(){}};channels.push(ch);return ch;};
  const pc={ connectionState:'connected',createDataChannel(name,o){opts=o;created++;return makeChannel();} };
  const t = new CupTransport((id,m)=>received.push([id,m]),()=>{}, {channelId:43,realtime:true}); t.sync([{id:7,pc}]);
  assert.deepEqual(opts,{negotiated:true,id:43,ordered:false,maxRetransmits:0});
  const ch=channels[0]; ch.readyState='closed'; t.sync([{id:7,pc}]); assert.equal(created,2);
  const replacement=channels[1];
  for(let i=0;i<40;i++) replacement.onmessage({data:JSON.stringify({protocol:1,type:'camera',id:999})});
  assert.equal(received.length,30); assert.ok(received.every(([id])=>id===7));
  replacement.onmessage({data:'x'.repeat(2001)}); assert.equal(received.length,30); t.sync([]); assert.equal(t.channels.size,0);
});
test('background recovery rebuilds mod channels and reopens the Cup handshake', () => {
  const c = new Controller(() => {}), recovered = [];
  c.transport.recover = () => recovered.push('cup');
  c.cameraTransport.recover = () => recovered.push('camera');
  c.lastHello = Date.now(); c.lastBroadcast = Date.now(); c.lastSubscribe = Date.now();
  c.resumeFromBackground();
  assert.deepEqual(recovered, ['cup', 'camera']);
  assert.equal(c.lastHello, 0); assert.equal(c.lastBroadcast, 0); assert.equal(c.lastSubscribe, 0);
});
test('ASAR repacking preserves binary content, empty files, nested assets, and rejects corrupt offsets', () => {
  const files = new Map([['a.bin',Buffer.from([0,255,1])],['nested/empty',Buffer.alloc(0)],['package.json',Buffer.from('{"version":"0.6.3"}')]]);
  const restored = unpack(pack(files)); for(const [name,data] of files) assert.deepEqual(restored.get(name),data);
  assert.throws(()=>unpack(Buffer.alloc(32))); assert.throws(()=>pack(new Map([['../x',Buffer.from('x')]])));
});


test('two controllers transfer a remote custom track and bind self-registration to native identity', async () => {
  const host=new Controller(()=>{}), client=new Controller(()=>{}); host.isHost=true; host.selfId=1; client.selfId=2;
  host.connection={}; client.connection={}; host.state=Cup.newCup(); client.state=Cup.publicState(host.state);
  host.lobby=[{id:1,nickname:'Organizer'},{id:2,nickname:'Remote'}]; host.hello.add(2);
  host.transport.send=(id,m)=>{assert.equal(id,2);client.receive(0,m);return true;};
  host.transport.broadcast=m=>client.receive(0,m);
  client.transport.send=(id,m)=>{assert.equal(id,0);host.receive(2,m);return true;};
  client.action('join', {id:1,name:'Impersonation'}); assert.equal(host.state.roster[0].id,2); assert.equal(host.state.roster[0].name,'Remote');
  const code='custom-track-data-'.repeat(3000), id='b'.repeat(64);
  host.native={parse:value=>{assert.equal(value,code);return {trackMetadata:{name:'Custom'},trackData:{getId:()=>id,hasStartingPoint:()=>true}};}};
  await client.importTrack(code); assert.equal(host.tracks.get(id).code,code); assert.equal(client.state.picks[2],id);
  assert.ok(validSnapshot(client.state)); assert.equal(client.pendingUpload,null);
  client.action('leave'); assert.equal(host.state.roster.length,0); assert.equal(host.tracks.size,0);
});
test('track transfer rejects spoofed cups, spectators, oversize, reordered and partial data', () => {
  const c=new Controller(()=>{});c.isHost=true;c.state=Cup.newCup();c.selfId=1;Cup.addPlayer(c.state,2,'Racer');c.hello.add(2);c.hello.add(3);
  const sent=[];c.transport.send=(id,m)=>{sent.push(m);return true;}; c.native={parse(){throw new Error('Should not parse invalid transfer');}};
  const begin={type:'track-begin',cupId:c.state.id,transferId:'a',length:10};
  c.receiveTrack(3,begin);c.receiveTrack(2,{...begin,cupId:'wrong'});assert.equal(c.trackUploads.size,0);
  c.receiveTrack(2,{...begin,length:2000001});assert.match(sent.at(-1).error,/size/);
  c.receiveTrack(2,begin);c.receiveTrack(2,{...begin,type:'track-chunk',seq:1,data:'x'});assert.equal(c.trackUploads.size,0);
  c.receiveTrack(2,begin);c.receiveTrack(2,{...begin,type:'track-end'});assert.match(sent.at(-1).error,/Incomplete/);
  c.receiveTrack(2,begin); c.trackUploads.get(2).until=0;c.receiveTrack(2,{...begin,type:'track-end'});assert.match(sent.at(-1).error,/expired/);
});
test('PB reports are informational, session-bound and identity-bound; stale record requests cannot overwrite another Cup', async () => {
  const c=new Controller(()=>{});c.isHost=true;c.selfId=1;c.connection={};c.state=race();c.broadcast=()=>{};
  const id=c.state.tracks[0].id, pb={status:'ready',frames:12345,source:'profile',token:'must not relay'};
  c.receivePB(2,{cupId:c.state.id,trackId:id,pb});assert.equal(c.state.records[id],undefined);
  c.receivePB(1,{cupId:'old',trackId:id,pb});assert.equal(c.state.records[id],undefined);
  c.receivePB(1,{cupId:c.state.id,trackId:id,pb});assert.deepEqual(c.state.records[id].pbs[1],{status:'ready',frames:12345,source:'profile'});
  c.receivePB(1,{cupId:c.state.id,trackId:id,pb:{...pb,frames:-1}});assert.equal(c.state.records[id].pbs[1].frames,12345);
  assert.ok(validSnapshot(c.networkState()));
  let finish; c.game={}; c.native={personalBest:()=>new Promise(resolve=>finish=resolve),worldRecord:async()=>({status:'missing'})};c.refreshRecords();
  await Promise.resolve();c.state=Cup.newCup('New Cup');finish(pb);await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(c.state.records,{});
});
test('compact live snapshots retain TR across tracks and round history truncation', () => {
  const c=new Controller(()=>{}); c.state=race();const s=c.state,id=s.runtime.trackId;
  Cup.recordFinish(s,1,1000,Date.now());Cup.completeRound(s);
  for(let i=0;i<5;i++){Cup.beginRound(s);s.phase='countdown';Cup.startRace(s,0);Cup.recordFinish(s,3,2000+i,3000);Cup.completeRound(s);}
  const snapshot=c.networkState();assert.equal(snapshot.matches[0].roundsLog.length,1);assert.equal(snapshot.records[id].tr.frames,1000);assert.ok(validSnapshot(snapshot));
});


test('native record adapter combines persistent profile PB with online PB and requests only the top WR', async () => {
  class Game { update(){} dispose(){} } class Library {}
  for(const name of ['getFirstSessionTrack','getRandomOfficialTrack','forEachTrack','forEachOfficialTrack','forEachCommunityTrack','forEachCustomTrack']) Library.prototype[name]=function(){};
  const game={},store={},profiles={profileSlot:1,getCurrentUserProfile:()=>({tokenHash:'test-only-profile-hash'})},jd=new WeakMap(),da=new WeakMap(),ha=new WeakMap();
  let local=23000, online=24000, calls=0;store.getRecordTime=()=>local===null?null:{numberOfFrames:local};
  const server={getLeaderboardUserEntry:async()=>{calls++;return online===null?null:{time:{numberOfFrames:online}};},getLeaderboard:async(hash,id,skip,amount,verified)=>{assert.equal(skip,0);assert.equal(amount,1);assert.equal(verified,true);return {entries:[{nickname:'Champion',frames:{numberOfFrames:22000}}]};}};
  jd.set(store,server);da.set(game,store);ha.set(game,profiles);
  const pml={polyVersion:'0.6.3',getFromPolyTrack:code=>Function('ii','vc','Is','du','jd','da','ha',`let bs=()=>{},Ss=()=>{};return ${code}`)(class{},class{},Game,Library,jd,da,ha)};
  const native=connectNative(pml,{});native.trackLibrary={isOfficialTrack:()=>true};
  assert.deepEqual(await native.personalBest(game,'track'),{status:'ready',frames:23000,source:'profile'});
  local=25000;assert.deepEqual(await native.personalBest(game,'track'),{status:'ready',frames:24000,source:'online'});assert.equal(calls,1);
  local=20000;assert.equal((await native.personalBest(game,'track')).frames,20000);
  assert.deepEqual(await native.worldRecord(game,'track'),{status:'ready',frames:22000,name:'Champion'});
  server.getLeaderboard=async()=>{throw new Error('Offline');};assert.deepEqual(await native.worldRecord(game,'other'),{status:'unavailable'});
});


test('automatic scheduling waits for recovery and resumes after a restarted round', () => {
  const c=new Controller(()=>{});c.isHost=true;c.connection={};c.broadcast=()=>{};c.save=()=>{};
  c.state=race();c.lobby=[1,3,5].map(id=>({id}));
  for(const id of [1,3,5,7]) Cup.markDNF(c.state,id);
  c.finishRound();assert.equal(c.auto,true);assert.equal(c.nextAuto,null);
  c.lobby.push({id:7});Cup.beginRound(c.state);c.state.phase='countdown';Cup.startRace(c.state,Date.now());
  for(const id of [1,3,5,7]) Cup.markDNF(c.state,id);
  c.finishRound();assert.ok(c.nextAuto>Date.now());
  c.toggleAutomaticRounds();assert.equal(c.auto,false);assert.equal(c.nextAuto,null);
});


test('non-racing Cup spectator entry restores the parent HUD without overriding Hide UI or dialogs', () => {
  class Game {update(){} dispose(){}} class Library {}
  const game={},hud={isVisible:true};let enabled=false;
  const spectator={get isEnabled(){return enabled;},set isEnabled(value){enabled=value;hud.isVisible=false;}};
  const fs=new WeakMap([[game,spectator]]),_a=new WeakMap([[game,hud]]),Ma=new WeakMap([[game,true]]);
  const pml={polyVersion:'0.6.3',getFromPolyTrack:code=>Function('ii','vc','Is','du','fs','_a','Ma',
    `let bs=()=>{},Ss=()=>{};return ${code}`)(class{},class{},Game,Library,fs,_a,Ma)};
  const native=connectNative(pml,{});
  native.enableCupSpectator(game);assert.equal(enabled,true);assert.equal(hud.isVisible,true);
  hud.isVisible=false;native.enableCupSpectator(game);assert.equal(hud.isVisible,false);
  enabled=false;Ma.set(game,false);native.enableCupSpectator(game);assert.equal(hud.isVisible,false);
  enabled=false;Ma.set(game,true);native.enableCupSpectator(game);assert.equal(hud.isVisible,true);
});


test('high latency and uneven arrivals retain smooth monotonic buffered playback', () => {
  const b=new CameraBuffer(),queue=[];
  for(let at=0;at<=6000;at+=50) queue.push({arrive:at+[310,410,360,440,330][at/50%5],p:{...pose(at),frames:at,position:[at/100,2,5],carPosition:[at/100,0,0]}});
  queue.sort((a,b)=>a.arrive-b.arrive);
  let prior=null,stalls=0,samples=0;
  for(let now=0;now<6000;now+=10){
    while(queue[0]?.arrive<=now){const packet=queue.shift();b.push(packet.p,now);}
    const p=b.playback(now,9,now);if(!p)continue;
    if(prior!==null&&now>1500){assert.ok(p.carPosition[0]>=prior);assert.ok(p.carPosition[0]-prior<=.111);if(p.carPosition[0]===prior)stalls++;samples++;}
    prior=p.carPosition[0];
  }
  assert.ok(samples>400);assert.ok(stalls<5,`stalled on ${stalls} frames`);
});
test('ghost visibility includes existing and newly spawned particles, without affecting other cars', () => {
  const mixins=[];registerCarVisibility({registerGlobalMixin:m=>mixins.push(m)},1);
  const [particles,carVisibility]=mixins;
  const meshes=new WeakMap();
  const attach=Function('a',`${particles.func.slice(0,-1)};`);
  const smoke=()=>{
    const instance={},mesh={visible:true,count:3};
    meshes.set(instance,mesh);attach.call(instance,meshes);
    return {instance,mesh};
  };
  const remote=smoke(),local=smoke(),car={},trail={},mesh={visible:true},name={visible:true};
  const apply=Function('e','Ae','Pe','E','Ue',carVisibility.func);
  const Ae=new WeakMap([[car,name]]),Pe=new WeakMap([[car,[trail]]]),E=new WeakMap([[trail,mesh]]);
  const Ue=new WeakMap([[car,remote.instance]]);
  apply.call(car,false,Ae,Pe,E,Ue);
  assert.equal(mesh.visible,false);assert.equal(name.visible,false);
  assert.equal(remote.mesh.visible,false);assert.equal(remote.mesh.count,3);
  remote.mesh.count=6; // Native particle updates continue while the mesh is hidden.
  assert.equal(remote.mesh.visible,false);assert.equal(local.mesh.visible,true);
  apply.call(car,true,Ae,Pe,E,Ue);
  assert.equal(mesh.visible,true);assert.equal(remote.mesh.visible,true);
  assert.equal(remote.mesh.count,6);
  Ue.set(car,null); // Particles disabled at lower graphics settings.
  assert.doesNotThrow(()=>apply.call(car,false,Ae,Pe,E,Ue));
});
