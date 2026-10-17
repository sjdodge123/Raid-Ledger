/**
 * Transport-only retry for the smoke suite's node-side `fetch`.
 *
 * WHY: on the rl-infra fleet the suite reaches the env through the Cloudflare
 * edge in front of `slot-N.gamernight.net`. undici's default 10s connect
 * timeout fires there occasionally — one dropped connect, on one API call, in
 * one spec — and surfaces as `TypeError: fetch failed` from inside a fixture.
 * That reads as a per-spec product failure: ROK-1309/1310 triage chased exactly
 * this on `lfg-group-page:255` and `lineup-abort:166`, both of which passed on
 * the next run with no code change.
 *
 * SCOPE — deliberately narrow, because a retry that hides real failures is far
 * worse than a flake:
 *   * ONLY thrown transport errors retry. Any HTTP RESPONSE — 400, 401, 409,
 *     429, 500 — is returned to the caller untouched, first time, every time.
 *     A 500 is the server answering; the connection worked.
 *   * A MUTATING request (anything but GET/HEAD/OPTIONS) retries only on a
 *     CONNECT-phase fault, where the request provably never reached the API.
 *     A reset or timeout mid-flight (ECONNRESET, UND_ERR_BODY_TIMEOUT) proves
 *     only that no response came BACK — the write may already have committed,
 *     and replaying a POST /events or POST /lineups would duplicate it or turn
 *     it into a 409. Codex P2. Safe methods retry on any transport fault.
 *   * Three attempts total, then the original error is rethrown unchanged so
 *     the failure message still names the real transport fault.
 *
 * The 250ms/750ms backoff is NOT a `sleep()`-style test wait: it is not
 * standing in for a missing readiness signal, and nothing about the assertion
 * depends on its duration. It exists because an immediate re-connect after a
 * dropped one usually drops again — the edge needs a moment. Bounded, capped
 * at ~1s total, and only ever reached on a connect failure.
 */

/** Backoff before attempt 2 and attempt 3. Length = MAX_ATTEMPTS - 1. */
const BACKOFF_MS = [250, 750];
export const MAX_FETCH_ATTEMPTS = BACKOFF_MS.length + 1;

/** undici / Node error codes that mean "the connection never carried a reply". */
const TRANSPORT_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'EPIPE',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENOTFOUND',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
]);

/**
 * Connect-phase subset: the connection was never established, so no request
 * bytes reached the server. Safe to replay even for a non-idempotent write.
 */
const CONNECT_PHASE_CODES = new Set([
    'UND_ERR_CONNECT_TIMEOUT',
    'ConnectTimeoutError',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENOTFOUND',
]);

/** Methods with no side effects — replaying them can't duplicate a write. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function codeOf(err: unknown): string {
    const e = err as { code?: unknown; name?: unknown } | null;
    if (!e) return '';
    return typeof e.code === 'string' ? e.code : typeof e.name === 'string' ? e.name : '';
}

/**
 * Is this a transport failure (no HTTP response was ever produced)?
 *
 * undici wraps the real cause: `TypeError: fetch failed` with `.cause` set to
 * e.g. `ConnectTimeoutError { code: 'UND_ERR_CONNECT_TIMEOUT' }`, so both the
 * outer error and its cause chain are inspected.
 */
export function isTransportError(err: unknown): boolean {
    let cur: unknown = err;
    for (let depth = 0; cur && depth < 5; depth++) {
        const code = codeOf(cur);
        if (TRANSPORT_CODES.has(code) || code.startsWith('UND_ERR_')) return true;
        if (code === 'ConnectTimeoutError' || code === 'SocketError') return true;
        const message = (cur as { message?: unknown }).message;
        if (typeof message === 'string' && /fetch failed|socket hang up|network error/i.test(message)) {
            return true;
        }
        cur = (cur as { cause?: unknown }).cause;
    }
    return false;
}

/**
 * Did the connection fail BEFORE any request bytes were sent? Only these are
 * replayable for a mutating request. A bare `TypeError: fetch failed` with no
 * recognisable code does NOT qualify — ambiguous means "do not replay a write".
 */
export function isConnectPhaseError(err: unknown): boolean {
    let cur: unknown = err;
    for (let depth = 0; cur && depth < 5; depth++) {
        if (CONNECT_PHASE_CODES.has(codeOf(cur))) return true;
        cur = (cur as { cause?: unknown }).cause;
    }
    return false;
}

/** The method a fetch call will actually use. */
function methodOf(input: string | URL | Request, init?: RequestInit): string {
    const raw =
        init?.method ??
        (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET');
    return String(raw ?? 'GET').toUpperCase();
}

/**
 * `fetch` with up to {@link MAX_FETCH_ATTEMPTS} attempts on transport errors.
 * Responses of every status are returned as-is, without retry. A mutating
 * method retries only on a connect-phase fault (see the module header).
 */
export async function fetchWithRetry(
    input: string | URL | Request,
    init?: RequestInit,
): Promise<Response> {
    const safe = SAFE_METHODS.has(methodOf(input, init));
    const retryable = safe ? isTransportError : isConnectPhaseError;
    for (let attempt = 0; ; attempt++) {
        try {
            return await fetch(input, init);
        } catch (err) {
            const last = attempt >= MAX_FETCH_ATTEMPTS - 1;
            if (last || !retryable(err)) throw err;
            const waitMs = BACKOFF_MS[attempt];
            console.warn(
                `[fetch-retry] transport error on ${String(
                    typeof input === 'string' ? input : (input as Request).url ?? input,
                )} (attempt ${attempt + 1}/${MAX_FETCH_ATTEMPTS}) — retrying in ${waitMs}ms: ${String(
                    (err as Error)?.message ?? err,
                )}`,
            );
            await new Promise((r) => setTimeout(r, waitMs));
        }
    }
}
