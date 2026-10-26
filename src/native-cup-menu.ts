import type { LoadedTrack, NativeConnection, PolyModLoader } from './game-types.ts';
import trophy from '../assets/toolbar-trophy.svg';
export const CUP_MENU_EVENT = 'polycup-open-menu';
const RACE_EVENT = 'polycup-start-native-race';
const PROFILE_EVENT = 'polycup-menu-profile';
const RETURN_EVENT = 'polycup-return-menu';

export function coverNativeMenu(covered: boolean) {
  if (!document.getElementById('polycup-menu-cover-style')) {
    const style = document.createElement('style');
    style.id = 'polycup-menu-cover-style';
    style.textContent = `
      body.polycup-menu-covered .menu-ui { visibility:hidden!important; pointer-events:none!important; }
      .menu-ui > .main-buttons-container:has(.polycup-menu-button) { padding-inline:24px; box-sizing:border-box; gap:4px; }
      .menu-ui > .main-buttons-container:has(.polycup-menu-button) > .button-image { min-width:0; flex:0 1 200px; }
      .menu-ui > .main-buttons-container:has(.polycup-menu-button) > .button-image > img { display:block; margin-inline:auto; width:min(96px,60%); height:auto; aspect-ratio:1; }
    `;
    document.head.append(style);
  }
  document.body.classList.toggle('polycup-menu-covered', covered);
}

/** Version-specific menu integration; ordinary Multiplayer and Play retain their handlers. */
export function registerCupMenu(pml: PolyModLoader, insert: unknown) {
  if (pml.polyVersion !== '0.6.3') return;
  pml.registerGlobalMixin({
    type: insert,
    token: 't = k.get("Lost connection to server");',
    func: `if(document.body.dataset.polycupNativeRace){t=null;delete document.body.dataset.polycupNativeRace;}`,
  });
  pml.registerGlobalMixin({
    type: insert,
    token: '(0, R.gn)(this, Gh, "f").push(S));',
    func: `
      {
        const cup = document.createElement('button');
        cup.className = 'button button-image polycup-menu-button';
        const icon = document.createElement('img');
        icon.src = ${JSON.stringify(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(trophy)}`)};
        icon.alt = ''; icon.style.filter = 'brightness(0) invert(1)';
        const label = document.createElement('p'); label.textContent = 'PolyCup';
        cup.append(icon,label);
        cup.addEventListener('click', () => { n.playUIClick(); window.dispatchEvent(new Event('${CUP_MENU_EVENT}')); });
        Bh.get(this).append(cup); Gh.get(this).push(cup);
      }
    `,
  });
  pml.registerGlobalMixin({
    type: insert,
    token: 'ee = 0;',
    func: `
    let polycupRaceRequest = null;
    let polycupReturning = null;
    window.addEventListener('${PROFILE_EVENT}', event => {
      const p = S.getCurrentUserProfile();
      event.detail.profile = { name: p.nickname || 'Player', country: p.countryCode || null, style: p.carStyle.serialize() };
      event.detail.trackLibrary = x;
    });
    window.addEventListener('${RETURN_EVENT}', () => {
      const returnedRace=document.body.dataset.polycupNativeRace;
      if (polycupRaceRequest) polycupRaceRequest.cancel();
      // Native departure can still be scheduling its own disconnect dialog.
      // Return after that transition so it cannot cover the Cup finder later.
      if (polycupReturning) return;
      polycupReturning = (async()=>{
        const until=performance.now()+10000;
        const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
        await pause();
        while(o.isTransitioning && performance.now()<until) await pause();
        if(o.isTransitioning) return false;
        const previous=$;
        K(false,null);
        while(($===previous || o.isTransitioning) && performance.now()<until) await pause();
        if(document.body.dataset.polycupNativeRace===returnedRace)delete document.body.dataset.polycupNativeRace;
        return $!==previous && !o.isTransitioning;
      })();
      const returning=polycupReturning;
      returning.finally(()=>{if(polycupReturning===returning)polycupReturning=null;});
    });
    window.addEventListener('${RACE_EVENT}', async event => {
      const request = event.detail;
      if (!request || typeof request.complete !== 'function') return;
      request.accepted = true;
      let waitingCancelled = false;
      request.cancel = () => { waitingCancelled = true; };
      if (polycupReturning && !await polycupReturning) { request.complete('Returning to the menu timed out. Try joining again.'); return; }
      if (waitingCancelled) { request.complete('Match start cancelled.'); return; }
      if (polycupRaceRequest || Za.get($)?.multiplayerConnection) { request.complete('Leave your current multiplayer game first.'); return; }
      document.body.dataset.polycupNativeRace=crypto.randomUUID();
      let connection = null, cancelled = false, timer = null;
      const cancel = () => { cancelled = true; connection?.dispose(); };
      polycupRaceRequest = { cancel };
      request.cancel = cancel;
      const deadline = performance.now()+60000;
      try {
        while (o.isTransitioning || !t.hasLoaded()) {
          if (cancelled || performance.now()>deadline) throw new Error('Game loading timed out.');
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        let metadata, trackData, sessionId, mode = 1;
        if (request.mode==='host') {
          if (!request.track?.trackData?.hasStartingPoint()) throw new Error('The first track could not be loaded.');
          metadata=request.track.trackMetadata; trackData=request.track.trackData;
          connection=new ii(k,T,16,S);
          sessionId=connection.startNewSessionImmediate(mode,metadata,trackData);
        } else {
          if (!/^[A-Z0-9]{8}$/.test(request.code)) throw new Error('Invalid race invitation.');
          connection=new vc(k,T,S,E);
          const cancellation=new Sr.A();
          const originalCancel=cancel;
          request.cancel=()=>{ cancellation.cancel(); originalCancel(); };
          await connection.joinInvite(request.code,cancellation);
          const session=await Promise.race([
            new Promise((resolve,reject)=>{
              const ready=(sessionId,gameMode,trackMetadata,trackData)=>{ connection.removeNewSessionCallback(ready);connection.removeConnectionLostCallback(lost);resolve({sessionId,gameMode,trackMetadata,trackData}); };
              const lost=()=>reject(new Error('Race connection was lost.'));
              connection.addNewSessionCallback(null,ready);connection.addConnectionLostCallback(lost);
            }),
            new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Track transfer timed out.')),45000);})
          ]);
          metadata=session.trackMetadata;trackData=session.trackData;sessionId=session.sessionId;mode=session.gameMode;
        }
        if (cancelled) throw new Error('Match start cancelled.');
        J(metadata,trackData,'custom',[],{multiplayerConnection:connection,sessionId,gameMode:mode},false);
        while (Za.get($)?.multiplayerConnection !== connection) {
          if (cancelled || performance.now()>deadline) throw new Error('Race loading timed out.');
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        request.complete(null,connection);
      } catch(error) { connection?.dispose(); request.complete(error?.message || 'Could not connect to the race.'); }
      finally { clearTimeout(timer); polycupRaceRequest=null; }
    });
  `,
  });
}
export function menuIdentity(): { name: string; country?: string | null; style?: string } {
  const detail: { profile?: { name: string; country?: string | null; style?: string } } = {};
  window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail }));
  return detail.profile ?? { name: 'Player' };
}
export function returnToNativeMenu() {
  window.dispatchEvent(new Event(RETURN_EVENT));
}
export function launchNativeRace(
  mode: 'host' | 'join',
  signal: AbortSignal,
  track?: LoadedTrack,
  code?: string,
): Promise<NativeConnection> {
  return new Promise((resolve, reject) => {
    const request = {
      mode,
      track,
      code,
      accepted: false,
      cancel: () => {},
      complete: (error?: string, connection?: NativeConnection) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (error || !connection) reject(new Error(error || 'Race connection unavailable.'));
        else resolve(connection);
      },
    };
    const abort = () => {
      request.cancel();
      request.complete('Match start cancelled.');
    };
    const timer = setTimeout(() => {
      request.cancel();
      request.complete('Race connection timed out.');
    }, 65000);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    window.dispatchEvent(new CustomEvent(RACE_EVENT, { detail: request }));
    if (!request.accepted) request.complete('The game is still loading. Try again.');
  });
}
