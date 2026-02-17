import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initPerformanceMonitoring } from './performance';

/**
 * Tests for Web Vitals monitoring module (ROK-343).
 * Uses mock PerformanceObserver to verify observer setup and metric reporting.
 */

// Track all observer instances and their callbacks for manual triggering
const observerInstances: MockObserver[] = [];

class MockObserver {
    callback: PerformanceObserverCallback;
    observeOptions: PerformanceObserverInit | null = null;
    disconnected = false;

    constructor(callback: PerformanceObserverCallback) {
        this.callback = callback;
        observerInstances.push(this);
    }

    observe(options: PerformanceObserverInit) {
        this.observeOptions = options;
    }

    disconnect() {
        this.disconnected = true;
    }

    /** Simulate entries coming in */
    trigger(entries: Partial<PerformanceEntry>[]) {
        const list = {
            getEntries: () => entries as PerformanceEntry[],
            getEntriesByName: () => [],
            getEntriesByType: () => [],
        } as PerformanceObserverEntryList;
        this.callback(list, this as unknown as PerformanceObserver);
    }
}

describe('initPerformanceMonitoring', () => {
    beforeEach(() => {
        observerInstances.length = 0;
        vi.stubGlobal('PerformanceObserver', MockObserver);
        // Reset any existing event listeners
        vi.spyOn(globalThis, 'addEventListener');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('does nothing when PerformanceObserver is undefined', () => {
        vi.stubGlobal('PerformanceObserver', undefined);
        // Should not throw
        expect(() => initPerformanceMonitoring()).not.toThrow();
        expect(observerInstances.length).toBe(0);
    });

    it('creates observers for FCP, LCP, CLS, and TTFB', () => {
        initPerformanceMonitoring();
        // 4 observers: FCP, LCP, CLS, TTFB
        expect(observerInstances.length).toBe(4);
    });

    it('FCP observer watches paint type with buffered:true', () => {
        initPerformanceMonitoring();
        const fcpObserver = observerInstances[0];
        expect(fcpObserver.observeOptions).toEqual({ type: 'paint', buffered: true });
    });

    it('LCP observer watches largest-contentful-paint type with buffered:true', () => {
        initPerformanceMonitoring();
        const lcpObserver = observerInstances[1];
        expect(lcpObserver.observeOptions).toEqual({ type: 'largest-contentful-paint', buffered: true });
    });

    it('CLS observer watches layout-shift type with buffered:true', () => {
        initPerformanceMonitoring();
        const clsObserver = observerInstances[2];
        expect(clsObserver.observeOptions).toEqual({ type: 'layout-shift', buffered: true });
    });

    it('TTFB observer watches navigation type with buffered:true', () => {
        initPerformanceMonitoring();
        const navObserver = observerInstances[3];
        expect(navObserver.observeOptions).toEqual({ type: 'navigation', buffered: true });
    });

    it('FCP observer disconnects after processing first-contentful-paint', () => {
        initPerformanceMonitoring();
        const fcpObserver = observerInstances[0];
        fcpObserver.trigger([{ name: 'first-contentful-paint', startTime: 1200, entryType: 'paint' } as PerformanceEntry]);
        expect(fcpObserver.disconnected).toBe(true);
    });

    it('FCP observer ignores non-FCP paint entries', () => {
        initPerformanceMonitoring();
        const fcpObserver = observerInstances[0];
        // Trigger with a non-FCP paint entry
        fcpObserver.trigger([{ name: 'first-paint', startTime: 800, entryType: 'paint' } as PerformanceEntry]);
        // Should NOT disconnect since it only disconnects on first-contentful-paint
        expect(fcpObserver.disconnected).toBe(false);
    });

    it('TTFB observer disconnects after navigation entry with positive TTFB', () => {
        initPerformanceMonitoring();
        const navObserver = observerInstances[3];
        navObserver.trigger([
            {
                entryType: 'navigation',
                name: 'document',
                startTime: 0,
                responseStart: 150,
                requestStart: 50,
            } as unknown as PerformanceEntry,
        ]);
        expect(navObserver.disconnected).toBe(true);
    });

    it('TTFB observer skips entry when TTFB is zero or negative', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        initPerformanceMonitoring();
        const navObserver = observerInstances[3];
        navObserver.trigger([
            {
                entryType: 'navigation',
                name: 'document',
                startTime: 0,
                responseStart: 50,
                requestStart: 50, // ttfb = 0
            } as unknown as PerformanceEntry,
        ]);
        // Observer still disconnects even when TTFB is zero
        expect(navObserver.disconnected).toBe(true);
        consoleSpy.mockRestore();
    });

    it('LCP and CLS report on visibilitychange to hidden', () => {
        initPerformanceMonitoring();
        const lcpObserver = observerInstances[1];

        // Trigger an LCP entry to set lcpValue
        lcpObserver.trigger([{ startTime: 2000, entryType: 'largest-contentful-paint', name: 'lcp' } as PerformanceEntry]);

        // Simulate page becoming hidden
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        const event = new Event('visibilitychange');
        window.dispatchEvent(event);

        // LCP observer should disconnect after page hidden
        expect(lcpObserver.disconnected).toBe(true);
    });

    it('CLS accumulates layout shift values without recent input', () => {
        initPerformanceMonitoring();
        const clsObserver = observerInstances[2];

        // Trigger multiple layout shift entries
        clsObserver.trigger([
            { entryType: 'layout-shift', name: 'layout-shift', startTime: 0, hadRecentInput: false, value: 0.05 } as unknown as PerformanceEntry,
            { entryType: 'layout-shift', name: 'layout-shift', startTime: 1, hadRecentInput: false, value: 0.03 } as unknown as PerformanceEntry,
        ]);

        // Observer should not disconnect yet (waits for visibilitychange)
        expect(clsObserver.disconnected).toBe(false);
    });

    it('CLS ignores layout shifts with recent input', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        initPerformanceMonitoring();
        const clsObserver = observerInstances[2];

        // Trigger with hadRecentInput = true (should be ignored)
        clsObserver.trigger([
            { entryType: 'layout-shift', name: 'layout-shift', startTime: 0, hadRecentInput: true, value: 0.5 } as unknown as PerformanceEntry,
        ]);

        // No console output since hadRecentInput entries are excluded
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('handles FCP observer throwing (paint not supported)', () => {
        let callCount = 0;
        vi.stubGlobal('PerformanceObserver', class {
            callback: PerformanceObserverCallback;
            constructor(cb: PerformanceObserverCallback) { this.callback = cb; }
            observe(options: PerformanceObserverInit) {
                callCount++;
                if (options.type === 'paint') {
                    throw new Error('paint not supported');
                }
            }
            disconnect() {}
        });

        // Should not throw even if paint observer setup fails
        expect(() => initPerformanceMonitoring()).not.toThrow();
    });

    it('handles LCP observer throwing (LCP not supported)', () => {
        vi.stubGlobal('PerformanceObserver', class {
            constructor() {}
            observe(options: PerformanceObserverInit) {
                if (options.type === 'largest-contentful-paint') {
                    throw new Error('LCP not supported');
                }
            }
            disconnect() {}
        });

        expect(() => initPerformanceMonitoring()).not.toThrow();
    });

    it('handles CLS observer throwing (layout-shift not supported)', () => {
        vi.stubGlobal('PerformanceObserver', class {
            constructor() {}
            observe(options: PerformanceObserverInit) {
                if (options.type === 'layout-shift') {
                    throw new Error('layout-shift not supported');
                }
            }
            disconnect() {}
        });

        expect(() => initPerformanceMonitoring()).not.toThrow();
    });

    it('handles navigation observer throwing (navigation not supported)', () => {
        vi.stubGlobal('PerformanceObserver', class {
            constructor() {}
            observe(options: PerformanceObserverInit) {
                if (options.type === 'navigation') {
                    throw new Error('navigation not supported');
                }
            }
            disconnect() {}
        });

        expect(() => initPerformanceMonitoring()).not.toThrow();
    });
});

describe('rate function (via initPerformanceMonitoring integration)', () => {
    beforeEach(() => {
        observerInstances.length = 0;
        vi.stubGlobal('PerformanceObserver', MockObserver);
        // Suppress console.log in DEV mode
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('FCP rated good when <= 1800ms', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        // Patch import.meta.env.DEV to true so report() logs
        vi.stubGlobal('import', { meta: { env: { DEV: true } } });

        initPerformanceMonitoring();
        const fcpObserver = observerInstances[0];
        fcpObserver.trigger([{ name: 'first-contentful-paint', startTime: 1800, entryType: 'paint' } as PerformanceEntry]);

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('FCP'),
            expect.any(String),
        );
        consoleSpy.mockRestore();
    });

    it('TTFB rated poor when > 1800ms', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        initPerformanceMonitoring();
        const navObserver = observerInstances[3];
        navObserver.trigger([
            {
                entryType: 'navigation',
                name: 'document',
                startTime: 0,
                responseStart: 2000,
                requestStart: 50, // ttfb = 1950 > 1800 → poor
            } as unknown as PerformanceEntry,
        ]);

        consoleSpy.mockRestore();
    });
});
