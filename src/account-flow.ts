export const ACCOUNT_STORAGE = 'polycup.account.v1';
export const PENDING_STORAGE = 'polycup.account.pending.v1';
export const LOGIN_LIFETIME = 10 * 60 * 1000;
export function validateAccountName(value: string) {
  const name = value.trim();
  if (!name || /^[\p{Z}\p{Cf}]*$/u.test(name)) throw new Error('Enter a PolyCup name.');
  if (/\p{Cc}/u.test(name))
    throw new Error('Names cannot contain line breaks or control characters.');
  // PostgreSQL char_length counts Unicode code points, not UTF-16 code units.
  if (Array.from(name).length > 32) throw new Error('Use 32 characters or fewer.');
  return name;
}
export type PendingLogin = { attempt: string; flowId?: string; expires: number; url: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const codePattern = /^[a-zA-Z0-9_-]{8,512}$/;

export function parseReturnCode(value: string, pending: PendingLogin | null, now = Date.now()) {
  if (!pending || now >= pending.expires)
    throw new Error('Sign-in expired. Start again with Discord.');
  const parts = value.trim().split(':');
  if (
    parts.length !== 3 ||
    parts[0] !== 'polycup1' ||
    !uuid.test(parts[1]) ||
    !codePattern.test(parts[2])
  )
    throw new Error('Paste the complete return code from the PolyCup sign-in page.');
  if (parts[1] !== pending.attempt)
    throw new Error('This code belongs to another sign-in. Use the latest sign-in page.');
  return parts[2];
}

export function readPending(storage: Storage, now = Date.now()): PendingLogin | null {
  try {
    const p = JSON.parse(storage.getItem(PENDING_STORAGE) ?? 'null');
    if (
      p &&
      uuid.test(p.attempt) &&
      Number.isFinite(p.expires) &&
      p.expires > now &&
      p.expires <= now + LOGIN_LIFETIME &&
      typeof p.url === 'string' &&
      (p.flowId === undefined || /^[a-zA-Z0-9_-]{8,64}$/.test(p.flowId))
    )
      return p;
  } catch {
    /* A stale or damaged pending login must not prevent opening the panel. */
  }
  storage.removeItem(PENDING_STORAGE);
  return null;
}

export function discordIdentity(metadata: Record<string, unknown>) {
  const text = (...keys: string[]) => {
    for (const key of keys) {
      if (typeof metadata[key] === 'string' && (metadata[key] as string).trim())
        return (metadata[key] as string)
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .trim()
          .slice(0, 80);
    }
    return '';
  };
  let avatar = '';
  try {
    // Image URLs are longer than display names; never truncate their path/hash.
    const rawAvatar = metadata.avatar_url ?? metadata.picture;
    if (typeof rawAvatar !== 'string' || rawAvatar.length > 2048) throw new Error();
    const url = new URL(rawAvatar);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) &&
      /^\/(avatars|embed\/avatars)\//.test(url.pathname)
    )
      avatar = url.href;
  } catch {
    /* Fall back to an initial when Discord supplies no avatar. */
  }
  const claims = metadata.custom_claims;
  const globalName =
    claims &&
    typeof claims === 'object' &&
    'global_name' in claims &&
    typeof claims.global_name === 'string'
      ? claims.global_name
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .trim()
          .slice(0, 80)
      : '';
  return {
    name: text('global_name') || globalName || text('full_name', 'name', 'user_name') || 'Player',
    username: text('user_name', 'preferred_username', 'full_name'),
    avatar,
  };
}

// Discord API tokens aren't needed for profile display. Keep only the Supabase
// session; PKCE verifiers live in this tab and cannot be overwritten by another tab.
export function accountStorage(persistent: Storage, tab: Storage) {
  return {
    getItem(key: string) {
      return (key.includes('code-verifier') ? tab : persistent).getItem(key);
    },
    setItem(key: string, value: string) {
      if (key === ACCOUNT_STORAGE) {
        const session = JSON.parse(value);
        delete session.provider_token;
        delete session.provider_refresh_token;
        value = JSON.stringify(session);
      }
      (key.includes('code-verifier') ? tab : persistent).setItem(key, value);
    },
    removeItem(key: string) {
      (key.includes('code-verifier') ? tab : persistent).removeItem(key);
    },
  };
}

export function clearPending(storage: Storage) {
  storage.removeItem(PENDING_STORAGE);
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key?.startsWith(ACCOUNT_STORAGE) && key.includes('code-verifier')) storage.removeItem(key);
  }
}
