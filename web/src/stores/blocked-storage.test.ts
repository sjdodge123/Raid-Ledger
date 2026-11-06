/**
 * Blocked storage (Safari private mode, disabled site data) makes every
 * localStorage call throw. The stores read it while they are created, so an
 * unguarded call there threw at import time and blanked the whole SPA.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/api-client', () => ({
    updatePreference: vi.fn(() => Promise.resolve()),
}));
vi.mock('../hooks/use-auth', () => ({
    getAuthToken: vi.fn(() => null),
}));

function denied(): never {
    throw new DOMException('The operation is insecure.', 'SecurityError');
}

/**
 * Chrome with site data blocked throws on reading the `localStorage` property
 * itself. Redefine the property (not `Storage.prototype` — on Node ≥24 the
 * test setup swaps in a plain-object polyfill a prototype spy never reaches).
 */
const hosts: object[] = [...new Set<object>([globalThis, window])];
const saved = new Map<object, PropertyDescriptor | undefined>();

describe('stores survive blocked localStorage', () => {
    beforeEach(() => {
        vi.resetModules();
        for (const host of hosts) {
            saved.set(host, Object.getOwnPropertyDescriptor(host, 'localStorage'));
            Object.defineProperty(host, 'localStorage', { configurable: true, get: denied });
        }
    });

    afterEach(() => {
        for (const host of hosts) {
            const original = saved.get(host);
            if (original) Object.defineProperty(host, 'localStorage', original);
            else Reflect.deleteProperty(host, 'localStorage');
        }
        saved.clear();
        vi.restoreAllMocks();
    });

    it('the block is in force: reading localStorage itself throws', () => {
        expect(() => window.localStorage).toThrow(DOMException);
        expect(() => globalThis.localStorage).toThrow(DOMException);
    });

    it('calendar view store initialises with a default view and its setter does not throw', async () => {
        await expect(import('./calendar-view-store')).resolves.toHaveProperty('useCalendarViewStore');
        const { useCalendarViewStore } = await import('./calendar-view-store');
        expect(['schedule', 'week']).toContain(useCalendarViewStore.getState().viewPref);

        expect(() => useCalendarViewStore.getState().setViewPref('month')).not.toThrow();
        expect(useCalendarViewStore.getState().viewPref).toBe('month');
    });

    it('timezone store initialises to auto and its setter does not throw', async () => {
        await expect(import('./timezone-store')).resolves.toHaveProperty('useTimezoneStore');
        const { useTimezoneStore } = await import('./timezone-store');
        expect(useTimezoneStore.getState().timezoneId).toBe('auto');

        expect(() => useTimezoneStore.getState().setTimezone('Europe/Berlin')).not.toThrow();
        expect(useTimezoneStore.getState().timezoneId).toBe('Europe/Berlin');
    });

    it('theme helpers fall back to default themes and persisting does not throw', async () => {
        const { initFromLocalStorage, persistToLocalStorage } = await import('./theme-helpers');
        expect(() => initFromLocalStorage()).not.toThrow();
        expect(initFromLocalStorage()).toEqual({
            mode: 'auto',
            lightTheme: 'default-light',
            darkTheme: 'default-dark',
        });

        expect(() =>
            persistToLocalStorage('dark', 'default-light', 'default-dark', 'default-dark'),
        ).not.toThrow();
    });
});
