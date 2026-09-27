import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { manualChunks } from './vite.manual-chunks'

const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
) as { version: string }

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
