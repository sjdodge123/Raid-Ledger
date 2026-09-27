import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { manualChunks, VENDOR_CHUNKS } from './vite.manual-chunks'

/**
 * ROK-1366: the production bundle ran Sentry.init before the magic-link
 * fragment strip because src/sentry.ts was split out of the entry chunk. App
 * modules must never be claimed by a vendor group; vendor groups claim only
 * their packages under node_modules.
 */
const app = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))
const nm = (pkgPath: string): string => `/repo/node_modules/${pkgPath}`

describe('ROK-1366: manualChunks keeps app code out of vendor chunks', () => {
    it.each([
        './src/sentry.ts',
        './src/lib/magic-link-capture.ts',
        './src/lib/magic-link.ts',
        './src/lib/sentry-scrub.ts',
        './src/lib/sentry-scrub-events.ts',
        './src/main.tsx',
    ])('leaves the app module %s to the default chunking', (rel) => {
        expect(manualChunks(app(rel)), `${rel} was assigned to a vendor chunk`).toBeUndefined()
    })

    it('does not treat an app path that merely mentions node_modules as vendor code', () => {
        expect(manualChunks('/repo/web/src/node_modules-sentry/@sentry/x.ts')).toBeUndefined()
    })

    it.each([
        '@sentry/react/build/esm/index.js',
        '@sentry/browser/build/npm/esm/index.js',
        '@sentry/core/build/esm/tracing/errors.js',
        '@sentry/replay/build/npm/esm/index.js',
        '@sentry/browser-utils/build/esm/metrics/instrument.js',
    ])('puts every @sentry package (%s) in the sentry chunk', (pkgPath) => {
        expect(manualChunks(nm(pkgPath))).toBe('sentry')
    })

    it('matches whole package segments only', () => {
        expect(manualChunks(nm('@sentry-internal/feedback/index.js'))).toBeUndefined()
        expect(manualChunks(nm('react-big-calendar/lib/index.js'))).toBe('calendar-vendor')
        expect(manualChunks(nm('react/index.js'))).toBe('react-vendor')
        expect(manualChunks('C:\\repo\\node_modules\\@sentry\\react\\index.js')).toBe('sentry')
    })

    it('keeps the vendor chunk names stable (bundle budgets key on them)', () => {
        expect(Object.keys(VENDOR_CHUNKS)).toEqual([
            'react-vendor',
            'query-vendor',
            'calendar-vendor',
            'sentry',
            'socket',
        ])
    })
})
