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
 * ROUND 4 REDESIGN, ROUND 5 CORRECTIONS. Rounds 1–3 patched the matcher three
 * times and each patch bought a new bug. The rules are now few enough to hold
 * in your head, and `sentry-scrub-secrets.test.ts` states every one of them as
 * an input → expected row plus `scrub(scrub(x)) === scrub(x)`:
 *
 *  1. A KEY is secret only when it is unambiguous: an exact name, a name
 *     ending in token/secret/password/passwd/pwd, or a credential-noun `key`
 *     compound (`api-key`, `X-Api-Key`, `awsSecretAccessKey`, `authKey`).
 *     `tokenCount`, `tokenizer`, `passwordPolicy`, `pwdTimeout`, `keyboard`,
 *     `queryKey`, `primaryKey`, `monkey` and `hotkey` survive. `_` and `-`
 *     are interchangeable everywhere a name is joined.
 *  2. A VALUE is scrubbed when (a) it is a known query/fragment param inside
 *     something that is actually a URL, (b) it follows a rule-1 key as
 *     `key=value` / `key: value` / `"key":"value"` anywhere in text, or (c) it
 *     follows `Bearer`/`Basic` — in any case.
 *  3. `code`, `state` and `key` are credentials ONLY as URL params — as bare
 *     JSON keys they are an HTTP status, a UI state and a keyboard key.
 *
 * There are no length caps: every quantifier is `+`/`*` over one character
 * class, which is linear, so a 200k-char string cannot blow up.
 */
import { scrubTokenFromUrl, SECRET_VALUE } from './sentry-scrub';

const FILTERED = '[Filtered]';

/* ------------------------------------------------------------------ keys */

/**
 * Names that are a credential on their own, compared case-insensitively.
 * Everything here is a credential in every context it can appear in — that is
 * the bar for membership, because a key match drops the WHOLE value whatever
 * its shape. `code`, `state` and `key` are deliberately absent (rule 3).
 */
const SECRET_KEY_EXACT = [
    'password',
    'passwd',
    'pwd',
    'secret',
    'token',
    'authorization',
    'proxy-authorization',
    'cookie',
    'cookies',
    'set-cookie',
    'session',
    'sessionid',
    'csrf',
    'credential',
    'credentials',
] as const;

/**
 * `accessToken`, `user_api_secret`, `clientSecret`, `db_pwd` — any name ENDING
 * in the noun. r6: `pwd` is a suffix, not only an exact name, because
 * `db_pwd=` and `db-pwd=` leaked. The whole-name anchor (`SECRET_KEY_WHOLE`)
 * and the `(?![A-Za-z0-9_-])` lookahead in the matcher mean only a TRAILING
 * `pwd` counts — `pwdTimeout` keeps its value. r7/r8: the suffix stays
 * unseparated (`DBPwd=`, `dbpwd=` are real credential keys); the shell's
 * `OLDPWD` is the one whole-name carve-out, via the leading lookahead. Bare
 * `pwd`/`PWD` stays an exact secret name: ODBC strings carry `Pwd=<password>`.
 */
const SECRET_NOUN_SUFFIX = String.raw`(?!OLDPWD(?![A-Za-z0-9_-]))[A-Za-z0-9_-]*(?:token|secret|password|passwd|pwd)`;

/**
 * r5 P2: a bare `key`/`Key` suffix is NOT a secret noun — `queryKey`,
 * `primaryKey`, `monkey`, `hotkey` and `keyboard` are ordinary diagnostics
 * whose values are worth keeping. A credential noun immediately in front of
 * `key` is what makes it one.
 *
 * r6: the prefix no longer demands a trailing `_`/`-`, and the joiner accepts
 * a hyphen, because `api-key=`, `X-Api-Key:`, `awsAccessKey=` and
 * `awsSecretAccessKey=` leaked under the r5 shape (all were scrubbed before
 * it). `client` and `auth` join the noun list for `clientKey` / `authKey`.
 */
const SECRET_KEY_COMPOUND =
    String.raw`[A-Za-z0-9_-]*(?:api|secret|private|access|signing|encryption|client|auth)[_-]?key`;

/**
 * THE one definition of a secret key. `isSecretKey` (object keys) and the
 * `key=value` matcher below are both built from it, so they cannot drift.
 *
 * r5 P1: the matcher used to capture a GENERIC key and then ask
 * `isSecretKey`. In `Error: password=swordfish` it matched `Error: password`,
 * found `Error` innocent, returned the match unchanged — and had already
 * consumed the embedded secret, so the scan resumed past it. Compiling the
 * key from this source means a non-secret key cannot match at all, and
 * nothing is ever skipped.
 */
const SECRET_KEY_SOURCE =
    `(?:${SECRET_NOUN_SUFFIX}|${SECRET_KEY_COMPOUND}|${SECRET_KEY_EXACT.join('|')})`;

const SECRET_KEY_WHOLE = new RegExp(`^${SECRET_KEY_SOURCE}$`, 'i');

/** Object keys whose whole value is dropped, whatever shape it has. */
export function isSecretKey(key: string): boolean {
    return SECRET_KEY_WHOLE.test(key.trim());
}

/* ------------------------------------------------------- 2a: URL params */

/**
 * Something that is actually a URL: a scheme, or a path-absolute `/` that
 * starts a word. Each branch carries a lookbehind so it can only start at a
 * word boundary — that is what stops `a/b?state=next` (division, or a ternary
 * in source-like text) from being read as a URL (Codex r4, #6), AND what
 * keeps the match linear: without it the scheme branch retried a longer and
 * longer letter run at all 200k offsets of the smoke string (38s). The scheme
 * itself is the one bounded quantifier in this file — a URI scheme is a short
 * word by definition, never the secret.
 */
const URL_LIKE =
    /(?:(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,15}:\/\/|(?<![A-Za-z0-9_])\/)[^\s"'<>]+/g;

/**
 * Query/fragment params that carry a credential. `code`, `state` and `key`
 * are here and NOT in the key set above: in a URL they are an OAuth code, an
 * OAuth state and an API key, and this matcher only ever runs inside a
 * `URL_LIKE` hit.
 */
const URL_PARAM_NAMES =
    String.raw`access_token|refresh_token|id_token|api_?key|token|code|state|secret|password|sig|signature|key`;
const URL_PARAM = new RegExp(String.raw`([?&#](?:${URL_PARAM_NAMES})=)` + SECRET_VALUE, 'gi');

/* -------------------------------------------- 2b/2c: keyed text + Bearer */

/**
 * `key=value`, `key: value`, `"key":"value"` or `'key': 'value'` anywhere in
 * text — a log line, a pasted header, a JSON body. The key part is compiled
 * from `SECRET_KEY_SOURCE`, so only a secret key can match.
 *
 * The `i` flag covers the key names AND the auth scheme (r5 P1 #2:
 * `Authorization: bearer eyJ…` used to miss the lowercase scheme, scrub the
 * word `bearer` as if it were the value, and ship the JWT).
 *
 * Groups: 1 the optional quote around the key (balanced via `\1`), 2 the key,
 * 3 the separator, 4 the gap after it, 5 an auth scheme, 6/7 a quoted value.
 * An unquoted value falls through to `SECRET_VALUE`.
 */
const KEYED_SECRET = new RegExp(
    String.raw`(?<![A-Za-z0-9_-])("?)(${SECRET_KEY_SOURCE})\1(?![A-Za-z0-9_-])` +
        String.raw`\s*([=:])(\s*)((?:Bearer|Basic)\s+|)` +
        String.raw`(?:"([^"]+)"|'([^']+)'|${SECRET_VALUE})`,
    'gi',
);

/**
 * The gap after `=`/`:` is dropped (`password= x` → `password=[Filtered]`) so
 * a second pass sees exactly what the first one wrote. It is kept only in
 * front of an auth scheme, because `Authorization: Bearer [Filtered]` is worth
 * more to triage than `Authorization:Bearer [Filtered]`.
 *
 * There is deliberately NO `isSecretKey` re-check here: re-deciding would
 * reintroduce the r5 P1 skip, because by this point the value has already
 * been consumed.
 */
function filterKeyed(
    _match: string,
    quote: string,
    key: string,
    separator: string,
    gap: string,
    scheme: string,
    doubleQuoted?: string,
    singleQuoted?: string,
): string {
    const spacing = scheme === '' ? '' : gap;
    const wrap = doubleQuoted === undefined ? (singleQuoted === undefined ? '' : "'") : '"';
    return `${quote}${key}${quote}${separator}${spacing}${scheme}${wrap}${FILTERED}${wrap}`;
}

/**
 * `Bearer <token>` with no key in front — a pasted curl line, a log message.
 * Any run of whitespace, any length: a one-character token is a credential.
 */
const BEARER = new RegExp(String.raw`\b(Bearer\s+)` + SECRET_VALUE, 'gi');

/** Strip URL secrets, keyed secrets and bearer tokens from one string. */
export function scrubSecretsFromText(value: string): string {
    const withoutPathTokens = scrubTokenFromUrl(value);
    const withoutUrlParams = withoutPathTokens.replace(URL_LIKE, (url) =>
        url.replace(URL_PARAM, `$1${FILTERED}`),
    );
    return withoutUrlParams.replace(KEYED_SECRET, filterKeyed).replace(BEARER, `$1${FILTERED}`);
}

/**
 * The placeholder itself: the value a secret-named key is replaced with, and
 * what a caller that clamps a scrubbed string must not cut through
 * (`components/feedback/feedback-scrub.ts`).
 */
export const SECRET_FILTERED = FILTERED;
