import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { manualChunks } from './vite.manual-chunks'

const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
) as { version: string }

/**
 * ROK-1154: bundle treemap for `npm run analyze -w web`, which sets ANALYZE=1.
 * Any other value (unset, `0`, `false`) never even imports the plugin module,
 * so a normal build is untouched. The report goes to web/.bundle-report/ (gitignored) and never
 * into dist: Dockerfile.allinone ships web/dist to nginx, so anything written
 * there would be served publicly in the prod image.
 *
 * @returns The visualizer plugin when analysis was requested, else `null`.
 */
function analyzePlugin(): PluginOption {
  if (process.env.ANALYZE !== '1') return null
  return import('rollup-plugin-visualizer').then(({ visualizer }) =>
    visualizer({
      filename: resolve(__dirname, '.bundle-report/stats.html'),
      template: 'treemap',
      gzipSize: true,
    }),
  )
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
    analyzePlugin(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
    // Per-build token for stable-name public scripts (the ndt7 worker): a
    // CDN caches those as `immutable`, response headers included, so a CSP
    // change never reaches an already-cached worker unless its url changes.
    __BUILD_ID__: JSON.stringify(process.env.APP_BUILD_ID ?? Date.now().toString(36)),
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
