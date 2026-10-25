import { accountConfig } from './account-config.ts';

export interface DesktopAuth {
  openDiscord(url: string): Promise<void>;
  requiresReturnCode?: boolean;
  startReturn?(attempt: string): Promise<string>;
  cancelReturn?(): Promise<void>;
  finishReturn?(attempt: string, success: boolean): Promise<void>;
  onReturn?(callback: (code: string) => void): () => void;
}

export function isDiscordSignInUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.origin === new URL(accountConfig.url).origin &&
      url.pathname === '/auth/v1/authorize' &&
      !url.username &&
      !url.password &&
      url.searchParams.get('provider') === 'discord'
    );
  } catch {
    return false;
  }
}

export function desktopAuth(): DesktopAuth | undefined {
  const host = window as Window & {
    polycupDesktop?: DesktopAuth;
    electron?: { getHelperPort?: () => unknown; getArgv?: () => unknown };
  };
  if (host.polycupDesktop) return host.polycupDesktop;
  // PolyLauncher 0.2.1 serves the game in a loopback iframe with its Electron
  // compatibility shim. Its sandbox blocks popups; the parent opens URLs instead.
  if (
    window.parent === window ||
    location.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(location.hostname) ||
    typeof host.electron?.getHelperPort !== 'function' ||
    typeof host.electron?.getArgv !== 'function'
  )
    return;
  try {
    if (host.electron.getHelperPort() !== null) return;
  } catch {
    return;
  }
  return {
    requiresReturnCode: true,
    async openDiscord(url) {
      if (!isDiscordSignInUrl(url)) throw new Error('Invalid Discord sign-in link.');
      // Matches PolyLauncher's injected external-link bridge. No token or PKCE
      // verifier is sent; only the normal public authorization URL leaves the game.
      window.parent.postMessage({ type: 'open-url', url }, '*');
    },
  };
}
