import { defineConfig } from 'vitest/config';

/**
 * Contract workspace vitest config (TDB:1246).
 *
 * Kept separate from the root config, which forces jsdom and the web setup
 * file. Only `src/**` is included: tsc emits `dist/__tests__/*.spec.js`,
 * and picking those up would run every spec twice.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        exclude: ['dist/**', 'node_modules/**'],
    },
});
