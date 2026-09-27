/**
 * Vendor chunk grouping for `vite build` (see vite.config.ts).
 *
 * Each key is an output chunk name, each value the npm packages whose modules
 * land in that chunk. An entry ending in `/` claims a whole npm scope. Chunk
 * names are load-bearing (bundle budgets key on them) — keep them stable.
 *
 * ROK-1366: only `node_modules` code may ever be assigned here. App modules
 * (e.g. src/sentry.ts) must stay in the default chunking, so their evaluation
 * order follows the source import graph (vite.manual-chunks.test.ts pins it).
 */
export const VENDOR_CHUNKS: Record<string, string[]> = {
  'react-vendor': ['react', 'react-dom', 'react-router-dom'],
  'query-vendor': ['@tanstack/react-query', 'zustand'],
  'calendar-vendor': ['react-big-calendar', 'date-fns'],
  sentry: ['@sentry/'],
  socket: ['socket.io-client'],
}

/** The `/node_modules/<pkg>/` (or `/node_modules/<scope>/`) segment to match. */
function packageSegment(pkg: string): string {
  return pkg.endsWith('/') ? `/node_modules/${pkg}` : `/node_modules/${pkg}/`
}

/**
 * Maps a module id to a vendor chunk name. Vite 8 builds with rolldown, whose
 * `manualChunks` is function-only (the Rollup object/record form was dropped),
 * so we resolve the chunk by matching the package path inside node_modules.
 *
 * @param moduleId - Absolute id of the module being bundled.
 * @returns The vendor chunk name, or `undefined` to use the default chunking.
 */
export function manualChunks(moduleId: string): string | undefined {
  const id = moduleId.replace(/\\/g, '/')
  if (!id.includes('/node_modules/')) return undefined
  for (const [chunk, pkgs] of Object.entries(VENDOR_CHUNKS)) {
    if (pkgs.some((pkg) => id.includes(packageSegment(pkg)))) return chunk
  }
  return undefined
}
