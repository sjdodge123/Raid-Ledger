/**
 * ROK-1409: pre-flight access-token staleness check.
 *
 * On app boot/resume with an expired 1h access token, every initial authed
 * query used to fire with the stale Bearer, 401, trigger a single-flight
 * refresh, and retry 1-2s later — 5-8 wasted round-trips + 401 noise in
 * logs/Sentry per resume. Decoding the JWT `exp` client-side lets callers
 * refresh ONCE up front, before the first request goes out.
 *
 * This module never validates the signature (it can't — the secret is
 * server-side) and never trusts `exp` for authz; it's a cheap heuristic to
 * decide "should I refresh before sending" and nothing more. The server
 * remains the source of truth via the reactive 401 backstop.
 */

interface JwtPayload {
  exp?: number;
}

/** Decode a base64url segment to its UTF-8 string, or null if it can't. */
function decodeBase64Url(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return atob(padded);
  } catch {
    return null;
  }
}

/** Parse the `exp` (seconds since epoch) out of a JWT, or null if undecodable. */
function readExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const json = decodeBase64Url(parts[1]);
  if (json === null) return null;
  try {
    const payload = JSON.parse(json) as JwtPayload;
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * True when the token is expired or within `skewSeconds` of expiry — i.e. the
 * caller should refresh before using it.
 *
 * A token whose `exp` is missing or that can't be decoded is treated as
 * NOT stale: we deliberately do NOT block/loop requests on a decode quirk.
 * If such a token really is expired the reactive 401 path still refreshes and
 * retries, so the worst case is the one wasted round-trip we already had —
 * never a false-positive refresh storm on a token we simply couldn't read.
 */
export function isTokenStale(token: string | null | undefined, skewSeconds = 30): boolean {
  if (!token) return true;
  const exp = readExp(token);
  if (exp === null) return false;
  const nowSeconds = Date.now() / 1000;
  return exp <= nowSeconds + skewSeconds;
}
