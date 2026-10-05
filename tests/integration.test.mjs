import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller, validSnapshot } from '../src/controller.mjs';
import * as Cup from '../src/cup.mjs';
import { CameraBuffer, validPose, renderCarPose } from '../src/spectator.mjs';
import { CupTransport, connectNative } from '../src/native.mjs';
import { pack, unpack } from '../scripts/asar.mjs';
function race() {
  const s = Cup.newCup();
  for (const i of [1,3,5,7]) { Cup.addPlayer(s,i,`P${i}`); Cup.chooseTrack(s,i,{id:String((i%3)+1).repeat(64),name:`T${i}`}); }
  Cup.lockRegistration(s);
  Cup.beginRound(s); s.runtime.sessionId = 9; s.phase = 'countdown'; Cup.startRace(s, Date.now() - 10000); return s;
}
const pose = (at = 1000) => ({ sessionId: 9, at, position: [0,1,2], quaternion: [0,0,0,1], fov: 75, frames: 1000, speed: 120,
  carPosition: [0,0,0], carQuaternion: [0,0,0,1], view: 0 });
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
test('disconnect choices produce DNF or a void, and stop automatic rounds', () => {
  for (const policy of ['dnf','void']) {
    const c = new Controller(() => {}); c.state = race(); c.state.disconnectPolicy = policy;
    c.auto = true; c.lobby = [1,3,5].map(id => ({ id })); c.checkDisconnects();
    assert.equal(c.auto, false);
    if (policy === 'dnf') assert.deepEqual(c.state.runtime.dnfs, [7]);
    else { assert.equal(c.state.runtime, null); assert.equal(c.state.phase, 'between-rounds'); }
  }
});
test('camera samples interpolate, reject stale sessions and invalid packets, and cut on respawn', () => {
  const b = new CameraBuffer(); assert.ok(b.push(pose()));
  assert.ok(b.push({ ...pose(1100), position: [10,1,2], frames: 1100, quaternion: [0,0,0,-1] }));
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
    assert.deepEqual(p.position.map((v, i) => v - p.carPosition[i]), [0, 2, 5]);
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
  c.bufferCamera(1,{...pose(1000), frames:1000, position:[0,0,0],carPosition:[0,0,0]});
  c.bufferCamera(1,{...pose(1100), frames:1100, position:[10,0,0],carPosition:[10,0,0]});
  let shown; c.native={visibility(){},follow(g,p,id){shown={p,id};},remoteFrame(){throw new Error('native timeline must not drive POV');}};
  c.afterGame(c.game);
  assert.equal(shown.id,1); assert.equal(shown.p.position[0],5); assert.equal(shown.p.carPosition[0],5);
});
test('transport binds messages to native peer identity, drops oversized/flooded packets, and uses separate camera channel', () => {
  let opts, received=[]; const ch={readyState:'open',bufferedAmount:0,close(){},send(){}};
  const pc={ connectionState:'connected',createDataChannel(name,o){opts=o;return ch;} };
  const t = new CupTransport((id,m)=>received.push([id,m]),()=>{}, {channelId:43,realtime:true}); t.sync([{id:7,pc}]);
  assert.deepEqual(opts,{negotiated:true,id:43,ordered:false,maxRetransmits:0});
  for(let i=0;i<40;i++) ch.onmessage({data:JSON.stringify({protocol:1,type:'camera',id:999})});
  assert.equal(received.length,30); assert.ok(received.every(([id])=>id===7));
  ch.onmessage({data:'x'.repeat(2001)}); assert.equal(received.length,30); t.sync([]); assert.equal(t.channels.size,0);
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
  let finish; c.native={personalBest:()=>new Promise(resolve=>finish=resolve),worldRecord:async()=>({status:'missing'})};c.refreshRecords();
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
