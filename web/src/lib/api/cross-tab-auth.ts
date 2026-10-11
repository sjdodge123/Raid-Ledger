import type { QueryClient } from '@tanstack/react-query';
import { AUTH_METHOD_KEY } from './auth-storage-keys';
import { clearAccessToken, isImpersonatingToken } from './access-token-store';
import { freshRefresh } from './refresh-client';
import { toast } from '../toast';

/**
 * ROK-1754 §3.3: tabs no longer share a token, so they share SIGNALS instead,
 * through `storage` events (which fire only in the OTHER tabs):
 * - the auth-method marker removed (logout, deactivation) → drop this tab's
 *   in-memory token and its `['auth','me']`; the route guards send it to /login.
 * - the marker appearing (a sign-in elsewhere) → re-check `['auth','me']`.
 * - the identity epoch bumped (impersonation start/stop) → re-mint from the
 *   shared cookie, which the server now answers as the new identity.
 */

/** Non-credential timestamp: "the cookie's identity changed — re-mint now". */
export const IDENTITY_EPOCH_KEY = 'raid_ledger_identity_epoch';

/** Tell every other tab the session's identity changed. Never throws. */
export function bumpIdentityEpoch(): void {
  try {
    localStorage.setItem(IDENTITY_EPOCH_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: other tabs follow on their next refresh */
  }
}

async function followIdentityChange(queryClient: QueryClient): Promise<void> {
  const wasImpersonating = isImpersonatingToken();
  clearAccessToken();
  // Never join a refresh POSTed under the old identity (review m1).
  const outcome = await freshRefresh();
  // Clearing memory first hides the end from use-auth's subscriber (review n1).
  // Only a definite re-mint says it ended: an indeterminate one leaves no token (fix-round n1).
  if (wasImpersonating && outcome.kind === 'ok' && !isImpersonatingToken()) toast.info('Impersonation ended');
  await queryClient.invalidateQueries();
}

function onMarkerChange(event: StorageEvent, queryClient: QueryClient): void {
  if (event.newValue === null) {
    clearAccessToken();
    queryClient.setQueryData(['auth', 'me'], null);
  } else if (event.oldValue === null) {
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  }
}

/** Install once per page (App.tsx). Returns the uninstaller (tests). */
export function installCrossTabAuth(queryClient: QueryClient): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === AUTH_METHOD_KEY) onMarkerChange(event, queryClient);
    else if (event.key === IDENTITY_EPOCH_KEY) void followIdentityChange(queryClient);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
