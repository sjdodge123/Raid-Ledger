/**
 * Shared stale-chunk detector (ROK-1763).
 *
 * After a deploy, an open tab can request a hashed route chunk that no longer
 * exists. Each engine words the failed dynamic `import()` differently:
 *   - Chrome/Edge: "Failed to fetch dynamically imported module: <url>"
 *   - Firefox:     "error loading dynamically imported module: <url>"
 *   - WebKit (Safari, every iPadOS/iOS browser): "Importing a module script failed."
 *   - Vite route CSS (thrown before the JS import): "Unable to preload CSS for <url>"
 *   - webpack-style chunks: "Loading (CSS) chunk N failed"
 * Used by `lazyWithRetry` (auto-reload once) and `ErrorFallback` (copy).
 */
const CHUNK_ERROR_PATTERNS = [
    'dynamically imported module',
    'importing a module script failed',
    'unable to preload css',
    'failed to fetch',
    'loading chunk',
    'loading css chunk',
] as const;

export function isChunkLoadError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return CHUNK_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

/** sessionStorage key holding the epoch ms of the last stale-chunk auto-reload. */
export const CHUNK_RELOAD_KEY = 'chunk-reload-attempted';

/**
 * A stale-chunk failure within this long of the last auto-reload is treated as
 * persistent (cached index.html, content blocker, CSP, broken deploy): it
 * surfaces to the error boundary instead of reloading again. Generous on
 * purpose — one reload cycle includes StartupGate's API wait, which can take
 * well over 10s on a slow device; too long costs one click, too short loops.
 */
export const CHUNK_RELOAD_WINDOW_MS = 2 * 60_000;

/**
 * ROK-2251: how long after this page claimed a reload other stale widgets wait
 * quietly for it. A reload normally unloads the page well inside this; if it
 * has not, it was cancelled (e.g. the hub's Leave-site prompt), and a later
 * stale widget falls back to its error cell + report instead of a skeleton
 * that never resolves. (The sessionStorage guard still blocks a second reload.)
 */
export const CHUNK_RELOAD_AWAIT_MS = 5_000;

/**
 * Epoch ms at which THIS page claimed a reload, or null. In memory on purpose:
 * a real reload wipes it, so after the reload a failure in the window is `none`.
 */
let reloadClaimedAt: number | null = null;

/**
 * Reload-once guard. Returns true — and stamps the attempt — only when no
 * auto-reload happened within the window, so a failure that survives the
 * reload cannot loop. Nothing clears the stamp; it simply ages out.
 */
export function claimChunkReload(now: number = Date.now()): boolean {
    try {
        const age = now - Number(sessionStorage.getItem(CHUNK_RELOAD_KEY));
        if (age >= 0 && age < CHUNK_RELOAD_WINDOW_MS) return false;
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
        reloadClaimedAt = now; // a route-level claim also quiets widgets failing alongside it
        return true;
    } catch {
        // Storage unavailable: no guard is possible, so never auto-reload.
        return false;
    }
}

/**
 * ROK-1901: the reload-once idiom for any on-demand chunk, as a promise
 * wrapper. A stale-chunk failure reloads the page once and never settles (the
 * fallback stays up until the reload); any other failure re-throws. Use it in
 * a `lazy()` factory only — never on a prefetch, which must fail silently.
 */
export function reloadOnChunkError<T>(load: Promise<T>): Promise<T> {
    return load.catch((error: unknown) => {
        if (isChunkLoadError(error) && claimChunkReload()) {
            window.location.reload();
            return new Promise<T>(() => {});
        }
        throw error;
    });
}

/**
 * ROK-2251: a dynamic-import / chunk-load failure only. Unlike
 * `isChunkLoadError` it does NOT match the bare "Failed to fetch" a network
 * `fetch()` throws — a widget render error carrying that is a real fault that
 * must reach Sentry, not a reason to reload. (Routes keep the broad matcher.)
 */
export function isDynamicImportError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return CHUNK_ERROR_PATTERNS.some((pattern) => pattern !== 'failed to fetch' && msg.includes(pattern));
}

/**
 * How a boundary should treat one error:
 *   - `reload`: this error claimed the reload-once guard — reload the page.
 *   - `awaiting-reload`: another error claimed a reload in THIS page within the
 *     last `CHUNK_RELOAD_AWAIT_MS` (several stale widgets failing together) —
 *     stay quiet, report nothing.
 *   - `none`: show the error cell and report it.
 */
export type ChunkReloadDecision = 'reload' | 'awaiting-reload' | 'none';

/** Test seam: simulate a fresh page lifetime (what a real reload does). */
export function resetChunkReloadPageState(): void {
    reloadClaimedAt = null;
}

function isAwaitingReload(now: number): boolean {
    if (reloadClaimedAt === null) return false;
    const age = now - reloadClaimedAt;
    return age >= 0 && age < CHUNK_RELOAD_AWAIT_MS;
}

function decideChunkReload(error: unknown, now: number = Date.now()): ChunkReloadDecision {
    if (!isDynamicImportError(error)) return 'none';
    if (isAwaitingReload(now)) return 'awaiting-reload';
    return claimChunkReload(now) ? 'reload' : 'none';
}

/**
 * ROK-2251: decided once per error object. Every caller that asks about the
 * same error gets the same answer — React may invoke an error boundary's
 * `getDerivedStateFromError` twice (StrictMode) and runs the root
 * `onCaughtError` hook before `componentDidCatch`, so the boundary and the
 * Sentry hook must agree without claiming the guard twice.
 */
const reloadDecisions = new WeakMap<object, ChunkReloadDecision>();

export function claimChunkReloadFor(error: unknown): ChunkReloadDecision {
    if (typeof error !== 'object' || error === null) return 'none';
    const known = reloadDecisions.get(error);
    if (known !== undefined) return known;
    const decision = decideChunkReload(error);
    reloadDecisions.set(error, decision);
    return decision;
}

/** Whether a reload is handling `error` (read-only; never claims). Sentry skips these. */
export function isReloadingChunkError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const decision = reloadDecisions.get(error);
    return decision === 'reload' || decision === 'awaiting-reload';
}
