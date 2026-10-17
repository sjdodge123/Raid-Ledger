/**
 * Local validation of a Steam OpenID 2.0 positive assertion (ROK-1731).
 *
 * Runs BEFORE `verifySteamOpenId` contacts Steam, so a forged, replayed or
 * mis-targeted assertion is rejected without a network round-trip. Steam's
 * `check_authentication` only proves Steam signed the fields; it does not
 * prove the assertion was issued for OUR return_to, recently, or once.
 *
 * Pure: no I/O, `now` injectable for tests. The specific `reason` is for
 * server logs only — callers surface one generic error (no oracle).
 */
import { STEAM_OPENID_URL } from './steam-http.util';

export const STEAM_OPENID_NS = 'http://specs.openid.net/auth/2.0';

/** A response_nonce older than this is rejected (OpenID 2.0 §11.4.2). */
export const STEAM_NONCE_MAX_AGE_MS = 5 * 60 * 1000;

/** Tolerated clock skew for a response_nonce stamped in the future. */
export const STEAM_NONCE_FUTURE_SKEW_MS = 60 * 1000;

/**
 * Fields that MUST appear in `openid.signed`. Steam's exact signed list is
 * UNVERIFIED (ROK-1731 OQ3) — if a captured real callback shows Steam omits
 * one of these, drop it here; this constant is the single source of truth.
 */
export const STEAM_OPENID_REQUIRED_SIGNED: readonly string[] = [
  'op_endpoint',
  'claimed_id',
  'identity',
  'return_to',
  'response_nonce',
  'assoc_handle',
];

const STEAM_CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/\d+$/;
const NONCE_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/;

export type SteamAssertionResult =
  { ok: true; nonce: string } | { ok: false; reason: string };

type Query = Record<string, string | undefined>;

function checkEnvelope(q: Query): string | null {
  if (q['openid.ns'] !== STEAM_OPENID_NS) return 'bad openid.ns';
  if (q['openid.mode'] !== 'id_res') return 'bad openid.mode';
  if (q['openid.op_endpoint'] !== STEAM_OPENID_URL) {
    return 'bad openid.op_endpoint';
  }
  return null;
}

function parseUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function checkReturnTo(
  q: Query,
  expected: string,
  state: string,
): string | null {
  const actual = parseUrl(q['openid.return_to']);
  if (!actual) return 'missing or unparseable openid.return_to';
  const want = new URL(expected);
  if (actual.origin !== want.origin) return 'return_to origin mismatch';
  if (actual.pathname !== want.pathname) return 'return_to path mismatch';
  if (!state || actual.searchParams.get('state') !== state) {
    return 'return_to state mismatch';
  }
  return null;
}

function checkIdentity(q: Query): string | null {
  const claimed = q['openid.claimed_id'];
  if (!claimed || !STEAM_CLAIMED_ID_RE.test(claimed)) {
    return 'bad openid.claimed_id';
  }
  if (q['openid.identity'] !== claimed) return 'claimed_id != identity';
  return null;
}

function checkSigned(q: Query): string | null {
  const signed = new Set(
    (q['openid.signed'] ?? '').split(',').map((f) => f.trim()),
  );
  const missing = STEAM_OPENID_REQUIRED_SIGNED.find((f) => !signed.has(f));
  return missing ? `openid.signed missing ${missing}` : null;
}

function checkNonce(nonce: string | undefined, now: number): string | null {
  if (!nonce) return 'missing openid.response_nonce';
  const stamp = NONCE_TIMESTAMP_RE.exec(nonce)?.[1];
  const issuedAt = stamp ? Date.parse(stamp) : NaN;
  if (Number.isNaN(issuedAt)) return 'malformed openid.response_nonce';
  if (now - issuedAt > STEAM_NONCE_MAX_AGE_MS) return 'stale response_nonce';
  if (issuedAt - now > STEAM_NONCE_FUTURE_SKEW_MS) {
    return 'future response_nonce';
  }
  return null;
}

/**
 * Validate a Steam OpenID callback query against the callback we issued.
 * @param expectedCallbackUrl `${apiBase}/auth/steam/link/callback` (no query)
 * @param state the callback request's own `state` query param
 */
export function validateSteamAssertion(
  query: Query,
  expectedCallbackUrl: string,
  state: string,
  now: number = Date.now(),
): SteamAssertionResult {
  const reason =
    checkEnvelope(query) ||
    checkReturnTo(query, expectedCallbackUrl, state) ||
    checkIdentity(query) ||
    checkSigned(query) ||
    checkNonce(query['openid.response_nonce'], now);
  if (reason) return { ok: false, reason };
  return { ok: true, nonce: query['openid.response_nonce'] as string };
}
