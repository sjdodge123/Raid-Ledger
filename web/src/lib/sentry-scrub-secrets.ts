/**
 * ROK-1838: one secret scrubber for every string that leaves the browser.
 *
 * Before this, only `transaction` / `request` / trace fields were scrubbed for
 * tokens (`sentry-scrub-events.ts`), so a pasted join link in an error message,
 * an exception value, `extra`, `contexts`, a breadcrumb or the feedback form
 * shipped `?token=…` verbatim. Error reporting is on by default now, so the
 * scrub has to be applied to strings at ANY depth, not to a field list.
 *
 * It is one string-level transform, run by the single recursive walk that
 * already copies an event (`sentry-scrub-pii.ts` — `scrubSensitiveString`),
 * so it reaches beforeSend, beforeSendTransaction and beforeBreadcrumb
 * together with the PII rules. The feedback submit path applies it directly
 * (`components/feedback/feedback-scrub.ts`) because that payload goes to our
 * own API, not through a Sentry hook.
 */
import { scrubTokenFromUrl } from './sentry-scrub';

const FILTERED = '[Filtered]';

/**
 * A secret-bearing query/fragment param, up to the next `&` or `#`. `token` is
 * also handled by `scrubTokenFromUrl` (fragment + path forms); the overlap is
 * harmless — the second pass sees `[Filtered]`.
 */
const SECRET_PARAM =
    /([#?&](?:access_?token|refresh_?token|id_?token|token|code|state|api_?key|key|secret|password|passwd|pwd)=)[^&#\s"']*/gi;

/** `Authorization: Bearer <jwt>` pasted into a log line or a bug report. */
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;

/** Strip URL secrets and bearer tokens from one string. */
export function scrubSecretsFromText(value: string): string {
    return scrubTokenFromUrl(value)
        .replace(SECRET_PARAM, `$1${FILTERED}`)
        .replace(BEARER, `$1${FILTERED}`);
}
