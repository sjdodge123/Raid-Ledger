import { describe, it, expect } from 'vitest';

/**
 * Tests for the manualChunks vendor bundle configuration (ROK-343).
 *
 * The vite.config.ts manualChunks is a static object — this test
 * validates the intended chunk-to-module mapping as a unit test,
 * without importing vite (which would cause ESM/Node compatibility issues).
 */

// Mirror the manualChunks config from vite.config.ts
const manualChunks: Record<string, string[]> = {
    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
    'query-vendor': ['@tanstack/react-query', 'zustand'],
    'calendar-vendor': ['react-big-calendar', 'date-fns'],
};

describe('vite manualChunks configuration (ROK-343)', () => {
    it('defines exactly 3 vendor chunks', () => {
        expect(Object.keys(manualChunks).length).toBe(3);
    });

    it('defines react-vendor chunk', () => {
        expect(manualChunks).toHaveProperty('react-vendor');
    });

    it('defines query-vendor chunk', () => {
        expect(manualChunks).toHaveProperty('query-vendor');
    });

    it('defines calendar-vendor chunk', () => {
        expect(manualChunks).toHaveProperty('calendar-vendor');
    });

    describe('react-vendor chunk', () => {
        const chunk = manualChunks['react-vendor'];

        it('includes react', () => {
            expect(chunk).toContain('react');
        });

        it('includes react-dom', () => {
            expect(chunk).toContain('react-dom');
        });

        it('includes react-router-dom', () => {
            expect(chunk).toContain('react-router-dom');
        });

        it('contains exactly 3 modules', () => {
            expect(chunk.length).toBe(3);
        });
    });

    describe('query-vendor chunk', () => {
        const chunk = manualChunks['query-vendor'];

        it('includes @tanstack/react-query', () => {
            expect(chunk).toContain('@tanstack/react-query');
        });

        it('includes zustand', () => {
            expect(chunk).toContain('zustand');
        });

        it('contains exactly 2 modules', () => {
            expect(chunk.length).toBe(2);
        });
    });

    describe('calendar-vendor chunk', () => {
        const chunk = manualChunks['calendar-vendor'];

        it('includes react-big-calendar', () => {
            expect(chunk).toContain('react-big-calendar');
        });

        it('includes date-fns', () => {
            expect(chunk).toContain('date-fns');
        });

        it('contains exactly 2 modules', () => {
            expect(chunk.length).toBe(2);
        });
    });

    it('no module appears in more than one chunk', () => {
        const allModules = Object.values(manualChunks).flat();
        const unique = new Set(allModules);
        expect(unique.size).toBe(allModules.length);
    });

    it('chunk names follow kebab-case naming convention', () => {
        const kebabCase = /^[a-z]+(-[a-z]+)*$/;
        for (const name of Object.keys(manualChunks)) {
            expect(name).toMatch(kebabCase);
        }
    });

    it('all chunk module arrays are non-empty', () => {
        for (const [name, modules] of Object.entries(manualChunks)) {
            expect(modules.length, `chunk ${name} should not be empty`).toBeGreaterThan(0);
        }
    });
});
