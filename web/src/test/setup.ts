import '@testing-library/jest-dom/vitest';
import * as matchers from 'vitest-axe/matchers';
import { expect, beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './mocks/server';

// Node 24 ships a built-in `localStorage` whose prototype shadows the jsdom
// polyfill — the result is an empty object with no `getItem`/`setItem`. Restore
// a working in-memory storage on `globalThis` and `window` before any source
// module reads `localStorage` at import time. See ROK-1114.
if (typeof globalThis.localStorage?.getItem !== 'function') {
    const store = new Map<string, string>();
    const polyfill: Storage = {
        get length() {
            return store.size;
        },
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        removeItem: (key: string) => void store.delete(key),
        setItem: (key: string, value: string) => void store.set(key, String(value)),
    };
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: polyfill,
    });
    if (typeof window !== 'undefined') {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: polyfill,
        });
    }
}

// vitest-axe matchers (toHaveNoViolations)
expect.extend(matchers);

// MSW server lifecycle
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Mock IntersectionObserver for tests that use infinite scroll (ROK-754)
if (typeof globalThis.IntersectionObserver === 'undefined') {
    globalThis.IntersectionObserver = class IntersectionObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof IntersectionObserver;
}

// Mock ResizeObserver for tests that use it (e.g., GameTimeGrid event overlays)
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}

// Mock matchMedia for tests importing theme-store (jsdom doesn't provide it)
if (typeof window.matchMedia === 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches: query.includes('dark'),
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }),
    });
}
