import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        // ROK-1285: a full `vitest run --coverage` on a high-core dev box forks
        // ~1 worker per core under v8 coverage, starving the event loop until
        // unlucky specs blow the 5s testTimeout (the pool even failed to *spawn*
        // workers — "[vitest-pool]: Failed to start forks worker"). Cap workers
        // to half the cores (ratio scales down on low-core CI too) and give the
        // starvation-prone async/poll specs real headroom. Not a module leak.
        // NB: vitest 4 removed `poolOptions`; min/maxWorkers are top-level now.
        testTimeout: 15000,
        minWorkers: 1,
        maxWorkers: '50%',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
            thresholds: { branches: 43, functions: 45, lines: 49, statements: 46 },
        },
    },
    resolve: {
        alias: {
            '@': '/src',
        },
    },
});
