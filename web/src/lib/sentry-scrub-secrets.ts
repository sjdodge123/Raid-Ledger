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
 *
 * Round 3 (Codex r3) tightened three things:
 *  - a secret value ends at structure (`"`, `'`, `,`, `}`, `]`, `)`) as well as
 *    whitespace / `&` / `#`, so scrubbing a JSON log line no longer eats the
 *    rest of the object;
 *  - `key=value` and the JSON forms `"key":"value"` / `key: value` match with
 *    no URL delimiter in front, so a bare `password=x` is caught;
 *  - the ambiguous keys (`code`, `state`, `key`) fire only inside something
 *    that actually looks like a URL, or as a quoted JSON key, so source-like
 *    text (`ready?state=nextState`) is left byte-identical.
 */
import { scrubTokenFromUrl } from './sentry-scrub';

const FILTERED = '[Filtered]';

/**
 * Where a secret value ends: whitespace, another query param, or the
 * punctuation that closes it inside JSON / a log line. Bounded, no nesting.
 */
const VALUE = String.raw`[^&#\s"',}\])]{0,4096}`;

/**
 * Skip a value that is already `[Filtered]`. The passes overlap by design (a
 * `?token=` is seen by both `scrubTokenFromUrl` and `SECRET_PARAM`), and
 * without this the second pass matched `[Filtered` — `]` ends a value — and
 * wrote `[Filtered]]`. It sits BEFORE the optional opening quote so the engine
 * cannot backtrack past it and re-filter `:"[Filtered]"`. Every matcher below
 * carries it, so the scrub is idempotent.
 */
const NOT_FILTERED = String.raw`(?!["']?\[Filtered\])`;

/**
 * Keys that are secret wherever they appear. `authorization`, `cookie` and
 * `session` are NOT here on purpose — as free text they are header lines whose
 * value is handled by `BEARER` below, and as object keys by `isSecretKey`;
 * matching them here would turn `Authorization: Bearer x` into two `[Filtered]`
 * runs and cost the triage signal.
 */
const ALWAYS_SECRET_KEY = String.raw`access_?token|refresh_?token|id_?token|token|api_?key|apikey|secret|password|passwd|pwd`;

/**
 * `key=value`, `"key":"value"` or `key: value` — no `?`/`&`/`#` required, so a
 * bare `password=swordfish` or a JSON body is covered.
 */
const SECRET_PARAM = new RegExp(
    String.raw`((?<![A-Za-z0-9])(?:${ALWAYS_SECRET_KEY})"?\s{0,8}[=:]\s{0,8}${NOT_FILTERED}["']?)${VALUE}`,
    'gi',
);

/** Keys that mean a credential only in a query string. */
const AMBIGUOUS_KEY = String.raw`code|state|key`;

/** Something that looks like a URL: a scheme, or a path starting with `/`. */
const URL_LIKE = /(?:https?:\/\/|\/)[^\s"'<>]{1,2048}/gi;

/** An ambiguous key as a query param — only ever run INSIDE a `URL_LIKE` hit. */
const URL_AMBIGUOUS_PARAM = new RegExp(
    String.raw`([?&#](?:${AMBIGUOUS_KEY})=)${NOT_FILTERED}${VALUE}`,
    'gi',
);

/** The same keys quoted as a JSON key, which is unambiguous enough on its own. */
const JSON_AMBIGUOUS_KEY = new RegExp(
    String.raw`("(?:${AMBIGUOUS_KEY})"\s{0,8}:\s{0,8}${NOT_FILTERED}["']?)${VALUE}`,
    'gi',
);

/**
 * `Authorization: Bearer <jwt>` pasted into a log line or a bug report. Any
 * length — a one-character token is still a credential (Codex r3).
 */
const BEARER = /\b(Bearer\s{1,8})(?!\[Filtered\])[A-Za-z0-9._~+/=-]{1,4096}/gi;

/** `?code=`/`&state=` inside URLs only, so source-like text is untouched. */
function scrubAmbiguousKeys(value: string): string {
    return value
        .replace(URL_LIKE, (url) => url.replace(URL_AMBIGUOUS_PARAM, `$1${FILTERED}`))
        .replace(JSON_AMBIGUOUS_KEY, `$1${FILTERED}`);
}

/** Strip URL secrets and bearer tokens from one string. */
export function scrubSecretsFromText(value: string): string {
    return scrubAmbiguousKeys(scrubTokenFromUrl(value))
        .replace(BEARER, `$1${FILTERED}`)
        .replace(SECRET_PARAM, `$1${FILTERED}`);
}

/**
 * Object keys whose WHOLE value is dropped, whatever its shape (Codex r3: a
 * structured `extra.password` or `request.headers.cookie` was reaching Sentry
 * because only the PII key set was consulted for keys).
 */
const SECRET_KEY_EXACT =
    /^(?:api[-_]?key|apikey|authorization|proxy-authorization|cookie|cookies|set-cookie|session|passwd|pwd|credentials?|auth)$/i;
const SECRET_KEY_PART = /token|secret|password/i;

export function isSecretKey(key: string): boolean {
    return SECRET_KEY_EXACT.test(key) || SECRET_KEY_PART.test(key);
}

export const SECRET_FILTERED = FILTERED;
