/**
 * ROK-1374 — the ndt7 speed test, wrapped so the rest of the app never sees
 * M-Lab. Two exports only: the D10 auto-run guard and a runner that yields a
 * single downstream figure in Mbps.
 *
 * The `@m-lab/ndt7-js` package is reached exclusively through the injectable
 * `load` parameter's DYNAMIC import, so it never lands in the main chunk (O5)
 * and tests can inject a fake without touching the network.
 */

/** Result of the D10 pre-flight guard. `reason` is `'ok'` when it passes. */
export interface SpeedTestGuardResult {
    ok: boolean;
    reason: string;
}

/** The slice of `navigator.connection` the guard reads. */
interface NetworkInformationLike {
    saveData?: boolean;
    type?: string;
    effectiveType?: string;
}

/** The slice of `navigator` the guard reads — kept tiny so tests can stub it. */
export interface NavigatorLike {
    connection?: NetworkInformationLike;
}

/** ndt7 measurement callbacks, narrowed to the one field we keep. */
type Ndt7Callbacks = Record<string, (data: unknown) => void>;

/** The one ndt7 entry point this module calls. */
interface Ndt7Api {
    test: (config: Record<string, unknown>, callbacks: Ndt7Callbacks) => Promise<number> | number;
}

/** Injectable module loader — the seam that keeps ndt7 out of the main chunk. */
export type Ndt7Loader = () => Promise<unknown>;

/** effectiveType values that mean "metered or too slow to spend 100 MB on". */
const CELLULAR_EFFECTIVE_TYPES = ['slow-2g', '2g', '3g'];

/**
 * Default loader: a dynamic import of the leaf module that owns the real
 * `@m-lab/ndt7-js` import, so ndt7 is never in the main chunk and is only
 * fetched when a measurement is actually requested.
 */
const defaultLoad: Ndt7Loader = () =>
    import('./ndt7-load').then((m) => m.loadNdt7());

/** Hard cap on a run. ndt7's own default is 10 s, which moves >1 GB on fibre. */
export const SPEED_TEST_TIMEOUT_MS = 5_000;

/**
 * Whether an automatic speed test is permitted right now (D10 / AC19).
 *
 * FAILS CLOSED: an absent `navigator.connection` (Safari/iOS, where cellular is
 * most likely) is `unknown-connection`, not permission.
 */
export function canAutoRunSpeedTest(
    nav: NavigatorLike = navigator as NavigatorLike,
): SpeedTestGuardResult {
    const connection = nav?.connection;
    if (!connection) return { ok: false, reason: 'unknown-connection' };
    if (connection.saveData === true) return { ok: false, reason: 'save-data' };
    if (connection.type === 'cellular') return { ok: false, reason: 'cellular' };
    if (
        connection.effectiveType &&
        CELLULAR_EFFECTIVE_TYPES.includes(connection.effectiveType)
    ) {
        return { ok: false, reason: 'cellular' };
    }
    return { ok: true, reason: 'ok' };
}

/** Pull the client-side mean Mbps out of a measurement, ignoring everything else. */
function readClientMbps(measurement: unknown): number | null {
    const m = measurement as { Source?: string; Data?: { MeanClientMbps?: number } };
    if (!m || m.Source !== 'client') return null;
    const mbps = m.Data?.MeanClientMbps;
    return typeof mbps === 'number' && mbps > 0 ? mbps : null;
}

/** Accept both `export default ndt7` and a namespace-style module shape. */
function resolveApi(mod: unknown): Ndt7Api {
    const candidate = (mod as { default?: Ndt7Api })?.default ?? (mod as Ndt7Api);
    if (typeof candidate?.test !== 'function') {
        throw new Error('ndt7 module did not expose a test() entry point');
    }
    return candidate;
}

/**
 * Run one download test and resolve its downstream Mbps.
 *
 * The ONLY value that escapes is the number: no server names, no latency
 * series, no IP-adjacent diagnostics (AC20). Capped at 5 s — the best figure
 * measured before the cap wins; a run that produced nothing rejects, so a
 * caller never writes a partial figure (E18).
 */
export function runSpeedTest(
    load: Ndt7Loader = defaultLoad,
): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        let best: number | null = null;
        let done = false;
        const settle = (err?: unknown): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (best !== null) resolve(best);
            else reject(err instanceof Error ? err : new Error('Speed test timed out'));
        };
        const timer = setTimeout(() => settle(), SPEED_TEST_TIMEOUT_MS);
        load()
            .then((mod) =>
                resolveApi(mod).test(
                    { userAcceptedDataPolicy: true },
                    {
                        downloadMeasurement: (data: unknown) => {
                            best = readClientMbps(data) ?? best;
                        },
                    },
                ),
            )
            .then(() => settle())
            .catch((err: unknown) => {
                done = true;
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error('Speed test failed'));
            });
    });
}
