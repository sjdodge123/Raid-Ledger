/**
 * ROK-2371: error narrowing shared by the Google sign-in + link flows.
 * Never surfaces a message body, code, state, token, email or `sub`.
 */
import { CalendarProviderError } from '../../calendar-sync/providers/calendar-provider.errors';
import { GoogleSigninClaimError } from './google-signin-claims.helpers';

function codeOf(v: unknown): unknown {
  return typeof v === 'object' && v !== null && 'code' in v
    ? v.code
    : undefined;
}

/** Postgres unique violation (23505), on the error or its `cause`. */
export function isUniqueViolation(err: unknown): boolean {
  if (codeOf(err) === '23505') return true;
  if (typeof err !== 'object' || err === null || !('cause' in err)) {
    return false;
  }
  return codeOf(err.cause) === '23505';
}

/**
 * A log-safe class for a failed code exchange: the error class plus the
 * already-sanitised provider reason / claim name (e.g.
 * `ProviderAuthError reason=redirect_uri_mismatch`). Nothing else.
 */
export function exchangeFailureClass(err: unknown): string {
  if (err instanceof CalendarProviderError) {
    return `${err.name} reason=${err.reason}`;
  }
  if (err instanceof GoogleSigninClaimError) {
    return `GoogleSigninClaimError claim=${err.claim}`;
  }
  return err instanceof Error ? err.constructor.name : 'unknown';
}
