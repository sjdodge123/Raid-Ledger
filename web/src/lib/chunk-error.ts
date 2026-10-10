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
 * surfaces to the error boundary instead of reloading again.
 */
export const CHUNK_RELOAD_WINDOW_MS = 10_000;

/**
 * Reload-once guard. Returns true — and stamps the attempt — only when no
 * auto-reload happened within the window, so a failure that survives the
 * reload cannot loop. Nothing clears the stamp; it simply ages out.
 */
export function claimChunkReload(now: number = Date.now()): boolean {
    const age = now - Number(sessionStorage.getItem(CHUNK_RELOAD_KEY));
    if (age >= 0 && age < CHUNK_RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
    return true;
}
