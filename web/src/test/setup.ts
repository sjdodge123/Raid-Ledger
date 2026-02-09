import '@testing-library/jest-dom/vitest';

// Mock ResizeObserver for tests that use it (e.g., GameTimeGrid event overlays)
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}
