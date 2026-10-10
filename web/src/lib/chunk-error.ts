/**
 * Shared stale-chunk detector (ROK-1763).
 *
 * After a deploy, an open tab can request a hashed route chunk that no longer
 * exists. Each engine words the failed dynamic `import()` differently:
 *   - Chrome/Edge: "Failed to fetch dynamically imported module: <url>"
 *   - Firefox:     "error loading dynamically imported module: <url>"
 *   - WebKit (Safari, every iPadOS/iOS browser): "Importing a module script failed."
 *   - Vite/webpack CSS + legacy chunks: "Loading (CSS) chunk N failed"
 * Used by `lazyWithRetry` (auto-reload once) and `ErrorFallback` (copy).
 */
const CHUNK_ERROR_PATTERNS = [
    'dynamically imported module',
    'importing a module script failed',
    'failed to fetch',
    'loading chunk',
    'loading css chunk',
] as const;

export function isChunkLoadError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return CHUNK_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}
