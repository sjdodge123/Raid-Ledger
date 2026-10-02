import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Root vitest config — enables running frontend tests from the project root:
 *   npx vitest run web/src/path/to/file.test.tsx
 *
 * Mirrors web/vitest.config.ts settings so jsdom environment is available.
 */
export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./web/src/test/setup.ts'],
        include: [
            'web/src/**/*.test.{ts,tsx}',
            // ROK-1085: unit tests for scripts/smoke helpers (excludes Playwright .smoke.spec.ts files).
            'scripts/smoke/**/*.spec.ts',
        ],
        exclude: ['**/node_modules/**', 'scripts/smoke/**/*.smoke.spec.ts'],
    },
    resolve: {
        alias: {
            '@': './web/src',
        },
    },
});
