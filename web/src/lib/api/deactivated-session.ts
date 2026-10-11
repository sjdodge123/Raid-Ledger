import {
  ACCESS_TOKEN_KEY,
  AUTH_METHOD_KEY,
  ORIGINAL_TOKEN_KEY,
  USER_CACHE_KEY,
} from './auth-storage-keys';

/**
 * ROK-1753: a deactivated user's session is terminal. The API answers every
 * authenticated request AND `POST /auth/refresh` with 401
 * `{ code: 'USER_DEACTIVATED' }` (403 from the defence-in-depth guard), so a
 * refresh can never help. The web stops there: it ends the session in the
 * SHARED localStorage — every other tab reads the same keys, and the refresh
 * lock re-checks them, so no tab replays the cookie — and lands on /login,
 * which shows the same error toast the banned/kicked OAuth path uses.
 *
 * Clearing the auth-method marker is the load-bearing part: it gates every
 * refresh probe (fetchWithAuth, fetchCurrentUser) and the silent Discord
 * re-auth, which would otherwise mint a new session that 401s again.
 */

export const USER_DEACTIVATED_CODE = 'USER_DEACTIVATED';
export const DEACTIVATED_LOGIN_PATH = '/login?error=deactivated';
export const DEACTIVATED_MESSAGE = 'Your account has been deactivated.';

const SESSION_KEYS = [ACCESS_TOKEN_KEY, ORIGINAL_TOKEN_KEY, USER_CACHE_KEY, AUTH_METHOD_KEY];

/** The `code` of a JSON error body, read from a clone (the body stays usable). */
export async function readErrorCode(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.clone().json();
    if (typeof body !== 'object' || body === null || !('code' in body)) return null;
    return typeof body.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

export async function isDeactivatedResponse(res: Response): Promise<boolean> {
  if (res.status !== 401 && res.status !== 403) return false;
  return (await readErrorCode(res)) === USER_DEACTIVATED_CODE;
}

function goTo(path: string): void {
  // replace, not assign: Back must not restore the dead page with its
  // requests left pending forever (fetchWithAuth never settles on this path).
  window.location.replace(path);
}

/**
 * End the session in every tab and show the deactivated notice on /login.
 * Already on /login (e.g. a password sign-in whose /auth/me 401s) → toast in
 * place, no redirect. Returns true when a redirect is under way.
 */
export function endDeactivatedSession(redirect: (path: string) => void = goTo): boolean {
  for (const key of SESSION_KEYS) localStorage.removeItem(key);
  if (window.location.pathname !== '/login') {
    redirect(DEACTIVATED_LOGIN_PATH);
    return true;
  }
  // The login page's ?error=deactivated handler already toasts that case.
  // Loaded lazily: a static import pulls `sonner` into the use-auth chunk
  // (+9 KB gz, over its bundle budget) for a path almost nobody hits.
  if (!window.location.search.includes('error=deactivated')) {
    void import('../toast').then(({ toast }) => toast.error(DEACTIVATED_MESSAGE));
  }
  return false;
}
