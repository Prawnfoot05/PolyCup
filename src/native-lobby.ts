import type { PolyModLoader } from './game-types.ts';
const EVENT = 'polycup-native-lobby-v1';
// PolyTrack 0.6.3's own menu transition owns disposal, joining and error display.
// Capture its existing callback once, after startup; do not recreate connections.
export function registerLobbyNavigation(pml: PolyModLoader, insert: unknown) {
  if (pml.polyVersion !== '0.6.3') return;
  pml.registerGlobalMixin({
    type: insert,
    token: 'ee = 0;',
    func: `
    let polycupNavigation = null;
    window.addEventListener('${EVENT}', event => {
      const request = event.detail;
      if (!request || typeof request.complete !== 'function' || !['host','join'].includes(request.mode)) return;
      if (request.mode === 'join' && !/^[A-Z0-9]{8}$/.test(request.code)) return;
      if (polycupNavigation) polycupNavigation.complete('Another navigation was started.');
      polycupNavigation = request;
      request.accepted = true;
      const deadline = performance.now() + 10000;
      let started = false;
      const attempt = () => {
        if (polycupNavigation !== request || started) return;
        if (performance.now() > deadline) {
          polycupNavigation = null;
          request.complete('The game is still loading. Try again in a moment.'); return;
        }
        if (Za.get($)?.multiplayerConnection) { polycupNavigation=null;request.complete('Leave your current lobby first.');return; }
        if (o.isTransitioning || !t.hasLoaded()) { setTimeout(attempt,100); return; }
        o.trigger(() => {
          if (polycupNavigation !== request) return;
          started = true;
          try {
            I.bQ(); I.pS(); $.dispose();
            $ = new bd(m,w,b,y,x,o,k,R,S,E,d,l,e,n,r,T,t,false,null,q,Q,J,X,Y,Z);
            Xh.call(vd.get($), request.mode === 'host', request.mode === 'join' ? request.code : null);
            I.PM(); request.complete();
          } catch { I.PM(); request.complete('Could not open multiplayer. Try again.'); }
          finally { if (polycupNavigation === request) polycupNavigation = null; }
        });
        // A native startup transition can replace a queued callback before it runs.
        setTimeout(attempt,400);
      };
      attempt();
    });
  `,
  });
}
export function openNativeLobby(mode: 'host' | 'join', code?: string): Promise<void> {
  if (mode === 'join' && (!code || !/^[A-Z0-9]{8}$/.test(code)))
    return Promise.reject(new Error('Invalid lobby code.'));
  return new Promise((resolve, reject) => {
    const request = {
      mode,
      code,
      accepted: false,
      complete: (error?: string) => (error ? reject(new Error(error)) : resolve()),
    };
    window.dispatchEvent(new CustomEvent(EVENT, { detail: request }));
    if (!request.accepted) reject(new Error('The game is still loading. Try again in a moment.'));
  });
}
