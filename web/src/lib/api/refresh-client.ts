import { API_BASE_URL } from '../config';
import { RefreshResponseSchema } from '@raid-ledger/contract';

/**
 * ROK-1353: single-flight access-token refresh.
 *
 * On a 401, callers invoke `ensureFreshToken()`. Concurrent callers (e.g.
 * several tabs / parallel requests) all await the SAME in-flight POST so the
 * refresh row is rotated exactly once — the server's atomic UPDATE + ±60s
 * grace covers any residual race. The raw refresh token lives only in the
 * httpOnly `rl_rt` cookie; this module never sees it.
 */

const TOKEN_KEY = 'raid_ledger_token';

let inFlight: Promise<string | null> | null = null;

/** Persist the freshly-minted access token where fetch-api reads it. */
function storeAccessToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const parsed = RefreshResponseSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    storeAccessToken(parsed.data.access_token);
    return parsed.data.access_token;
  } catch {
    return null;
  }
}

/**
 * Refresh the access token via the httpOnly cookie. Returns the new token,
 * or null if the cookie is missing/expired/revoked. Single-flight: parallel
 * calls share one network request.
 */
export function ensureFreshToken(): Promise<string | null> {
  if (!inFlight) {
    inFlight = doRefresh().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
