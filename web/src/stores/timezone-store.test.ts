import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/api-client', () => ({
    updatePreference: vi.fn(() => Promise.resolve()),
}));
vi.mock('../hooks/use-auth', () => ({
    getAuthToken: vi.fn(() => null),
}));

const LS_TIMEZONE_KEY = 'raid_ledger_timezone';

async function loadStore() {
    vi.resetModules();
    const { useTimezoneStore } = await import('./timezone-store');
    return useTimezoneStore;
}

describe('useTimezoneStore — stored zone validation', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => localStorage.clear());

    it('keeps a valid stored IANA zone', async () => {
        localStorage.setItem(LS_TIMEZONE_KEY, 'America/New_York');
        const store = await loadStore();
        expect(store.getState().timezoneId).toBe('America/New_York');
        expect(store.getState().resolved).toBe('America/New_York');
    });

    it('keeps auto as a valid stored value', async () => {
        localStorage.setItem(LS_TIMEZONE_KEY, 'auto');
        const store = await loadStore();
        expect(store.getState().timezoneId).toBe('auto');
    });

    it('falls back to auto for an invalid stored zone', async () => {
        localStorage.setItem(LS_TIMEZONE_KEY, 'Not/AZone');
        const store = await loadStore();
        expect(store.getState().timezoneId).toBe('auto');
        expect(store.getState().resolved).not.toBe('Not/AZone');
    });

    it('setTimezone stores auto instead of an invalid zone', async () => {
        const store = await loadStore();
        store.getState().setTimezone('Not/AZone');
        expect(store.getState().timezoneId).toBe('auto');
        expect(localStorage.getItem(LS_TIMEZONE_KEY)).toBe('auto');
    });
});
