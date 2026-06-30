import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
) as { version: string }

/**
 * Vendor chunk grouping: each key is an output chunk name, each value the list
 * of npm package names whose modules should land in that chunk.
 */
const VENDOR_CHUNKS: Record<string, string[]> = {
  'react-vendor': ['react', 'react-dom', 'react-router-dom'],
  'query-vendor': ['@tanstack/react-query', 'zustand'],
  'calendar-vendor': ['react-big-calendar', 'date-fns'],
  sentry: ['@sentry/react'],
  socket: ['socket.io-client'],
}

/**
 * Maps a module id to a vendor chunk name. Vite 8 builds with rolldown, whose
 * `manualChunks` is function-only (the Rollup object/record form was dropped),
 * so we resolve the chunk by matching the package path inside node_modules.
 *
 * @param moduleId - Absolute id of the module being bundled.
 * @returns The vendor chunk name, or `undefined` to use the default chunking.
 */
function manualChunks(moduleId: string): string | undefined {
  if (!moduleId.includes('node_modules')) return undefined
  for (const [chunk, pkgs] of Object.entries(VENDOR_CHUNKS)) {
    if (pkgs.some((pkg) => moduleId.includes(`node_modules/${pkg}/`))) {
      return chunk
    }
  }
  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // ROK-306: Upload source maps to Sentry during production builds.
    // Only activates when SENTRY_AUTH_TOKEN is set (CI/build environment only).
    sentryVitePlugin({
      org: process.env.SENTRY_ORG ?? 'raid-ledger',
      project: process.env.SENTRY_PROJECT ?? 'raid-ledger-web',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: rootPkg.version },
      sourcemaps: { filesToDeleteAfterUpload: ['**/*.map'] },
      // Silently skip when SENTRY_AUTH_TOKEN is not set (local dev)
      disable: !process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
})
