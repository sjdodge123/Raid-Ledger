/**
 * ROK-1374 — the ndt7 speed test, wrapped so the rest of the app never sees
 * M-Lab. One export that matters: a runner yielding a single downstream figure
 * in Mbps. Every run is started by a human — the app never measures on its own
 * (operator ruling 2026-09-05), so there is no pre-flight connection guard.
 *
 * The `@m-lab/ndt7` package is reached exclusively through the injectable
 * `load` parameter's DYNAMIC import, so it never lands in the main chunk (O5)
 * and tests can inject a fake without touching the network.
 *
 * WHAT THE 5 s CAP DOES AND DOES NOT DO: it bounds how long the CALLER waits,
 * not how much data moves. ndt7 owns the download inside a Worker it never
 * hands out (the handle is closure-local in the library and only the library
 * terminates it), so there is no abort path to call: a run the cap gave up on
 * keeps downloading in the background until ndt7's own ~10 s server-driven test
 * finishes. The consent copy therefore quotes the FULL transfer, not the
 * 5 s slice we wait for — see `ConnectionSpeedConsentModal`.
 */

/** ndt7 measurement callbacks, narrowed to the one field we keep. */
type Ndt7Callbacks = Record<string, (data: unknown) => void>;

/**
 * The ndt7 entry points this module calls. `test()` runs a download AND an
 * upload; `discoverServerURLs()` + `downloadTest()` run only the download —
 * half the transfer for the one number the card needs. `test()` stays as the
 * fallback for a module shape that lacks the split entry points.
 */
interface Ndt7Api {
    test: (
        config: Record<string, unknown>,
        callbacks: Ndt7Callbacks,
    ) => Promise<number> | number;
    discoverServerURLs?: (
        config: Record<string, unknown>,
        callbacks: Ndt7Callbacks,
    ) => Promise<unknown>;
    downloadTest?: (
        config: Record<string, unknown>,
        callbacks: Ndt7Callbacks,
        urls: Promise<unknown>,
    ) => Promise<number> | number;
}

/** Injectable module loader — the seam that keeps ndt7 out of the main chunk. */
export type Ndt7Loader = () => Promise<unknown>;

/**
 * Default loader: a dynamic import of the leaf module that owns the real
 * `@m-lab/ndt7` import, so ndt7 is never in the main chunk and is only
 * fetched when a measurement is actually requested.
 */
const defaultLoad: Ndt7Loader = () =>
    import('./ndt7-load').then((m) => m.loadNdt7());

/** Hard cap on a run. ndt7's own default is 10 s, which moves >1 GB on fibre. */
export const SPEED_TEST_TIMEOUT_MS = 5_000;

/** Pull the client-side mean Mbps out of a measurement, ignoring everything else. */
function readClientMbps(measurement: unknown): number | null {
    const m = measurement as {
        Source?: string;
        Data?: { MeanClientMbps?: number };
    };
    if (!m || m.Source !== 'client') return null;
    const mbps = m.Data?.MeanClientMbps;
    return typeof mbps === 'number' && mbps > 0 ? mbps : null;
}

/** Download only when the module offers it; the full test moves twice the data. */
function runDownloadOnly(
    api: Ndt7Api,
    config: Record<string, unknown>,
    callbacks: Ndt7Callbacks,
): Promise<number> | number {
    if (api.discoverServerURLs && api.downloadTest) {
        return api.downloadTest(
            config,
            callbacks,
            api.discoverServerURLs(config, callbacks),
        );
    }
    return api.test(config, callbacks);
}

/** Accept both `export default ndt7` and a namespace-style module shape. */
function resolveApi(mod: unknown): Ndt7Api {
    const candidate =
        (mod as { default?: Ndt7Api })?.default ?? (mod as Ndt7Api);
    if (typeof candidate?.test !== 'function') {
        throw new Error('ndt7 module did not expose a test() entry point');
    }
    return candidate;
}

/** The callbacks handed to ndt7: keep the latest client figure, drop the rest. */
function collectLatest(onMbps: (mbps: number) => void): Ndt7Callbacks {
    return {
        downloadMeasurement: (data: unknown) => {
            const mbps = readClientMbps(data);
            if (mbps !== null) onMbps(mbps);
        },
    };
}

/**
 * The config every ndt7 entry point is handed.
 *
 * `downloadworkerfile` is not optional in practice: ndt7's default is the
 * page-relative `'ndt7-download-worker.js'`, which this app does not serve, so
 * a run without it dies constructing the Worker. The url is resolved through
 * the same leaf module that owns the library import, so it is still one lazy
 * hop rather than a static dependency on M-Lab.
 */
async function buildConfig(): Promise<Record<string, unknown>> {
    const { ndt7DownloadWorkerUrl } = await import('./ndt7-load');
    return {
        userAcceptedDataPolicy: true,
        downloadworkerfile: ndt7DownloadWorkerUrl(),
    };
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
    onSample?: (mbps: number) => void,
): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        let best: number | null = null;
        let done = false;
        const settle = (err?: unknown): void => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (best !== null) resolve(best);
            else
                reject(
                    err instanceof Error
                        ? err
                        : new Error('Speed test timed out'),
                );
        };
        const fail = (err: unknown): void => {
            done = true;
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error('Speed test failed'));
        };
        const timer = setTimeout(() => settle(), SPEED_TEST_TIMEOUT_MS);
        const callbacks = collectLatest((mbps) => {
            best = mbps;
            // Live figure for the gauge — still only the number (AC20).
            onSample?.(mbps);
        });
        Promise.all([load(), buildConfig()])
            .then(([mod, config]) =>
                runDownloadOnly(resolveApi(mod), config, callbacks),
            )
            .then(() => settle())
            .catch(fail);
    });
}
