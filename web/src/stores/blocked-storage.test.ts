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

describe('stores survive blocked localStorage', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calendar view store initialises with a default view and its setter does not throw', async () => {
        const { useCalendarViewStore } = await import('./calendar-view-store');
        expect(['schedule', 'week']).toContain(useCalendarViewStore.getState().viewPref);

        expect(() => useCalendarViewStore.getState().setViewPref('month')).not.toThrow();
        expect(useCalendarViewStore.getState().viewPref).toBe('month');
    });

    it('timezone store initialises to auto and its setter does not throw', async () => {
        const { useTimezoneStore } = await import('./timezone-store');
        expect(useTimezoneStore.getState().timezoneId).toBe('auto');

        expect(() => useTimezoneStore.getState().setTimezone('Europe/Berlin')).not.toThrow();
        expect(useTimezoneStore.getState().timezoneId).toBe('Europe/Berlin');
    });

    it('theme helpers fall back to default themes and persisting does not throw', async () => {
        const { initFromLocalStorage, persistToLocalStorage } = await import('./theme-helpers');
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
