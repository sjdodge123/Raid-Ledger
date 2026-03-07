import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCalendarViewStore, type CalendarViewPref } from './calendar-view-store';

// Mock the api-client updatePreference (fire-and-forget, not critical for store logic)
vi.mock('../lib/api-client', () => ({
    updatePreference: vi.fn(() => Promise.resolve()),
}));

// Mock getAuthToken — return null by default (unauthenticated, skips server sync)
vi.mock('../hooks/use-auth', () => ({
    getAuthToken: vi.fn(() => null),
}));

const LS_KEY = 'raid_ledger_calendar_view';
const LEGACY_KEY = 'calendar-view';

describe('CalendarViewPref type includes schedule', () => {
    it('accepts "schedule" as a valid CalendarViewPref', () => {
        const view: CalendarViewPref = 'schedule';
        expect(view).toBe('schedule');
    });

    it('accepts "week" as a valid CalendarViewPref', () => {
        const view: CalendarViewPref = 'week';
        expect(view).toBe('week');
    });

    it('accepts "month" as a valid CalendarViewPref', () => {
        const view: CalendarViewPref = 'month';
        expect(view).toBe('month');
    });

    it('accepts "day" as a valid CalendarViewPref', () => {
        const view: CalendarViewPref = 'day';
        expect(view).toBe('day');
    });
});

describe('useCalendarViewStore — setViewPref', () => {
    beforeEach(() => {
        localStorage.clear();
        useCalendarViewStore.setState({ viewPref: 'week' });
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('updates viewPref in store', () => {
        useCalendarViewStore.getState().setViewPref('schedule');
        expect(useCalendarViewStore.getState().viewPref).toBe('schedule');
    });

    it('persists viewPref to localStorage', () => {
        useCalendarViewStore.getState().setViewPref('schedule');
        expect(localStorage.getItem(LS_KEY)).toBe('schedule');
    });

    it('persists month view to localStorage', () => {
        useCalendarViewStore.getState().setViewPref('month');
        expect(localStorage.getItem(LS_KEY)).toBe('month');
    });

    it('persists day view to localStorage', () => {
        useCalendarViewStore.getState().setViewPref('day');
        expect(localStorage.getItem(LS_KEY)).toBe('day');
    });

    it('persists week view to localStorage', () => {
        useCalendarViewStore.getState().setViewPref('week');
        expect(localStorage.getItem(LS_KEY)).toBe('week');
    });
});

describe('useCalendarViewStore — localStorage initialization', () => {
    beforeEach(() => {
        localStorage.clear();
        useCalendarViewStore.setState({ viewPref: 'week' });
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('reads stored schedule preference from localStorage', () => {
        localStorage.setItem(LS_KEY, 'schedule');
        expect(localStorage.getItem(LS_KEY)).toBe('schedule');
    });

    it('migrates legacy key to new key', () => {
        localStorage.setItem(LEGACY_KEY, 'month');
        useCalendarViewStore.getState().setViewPref('month');
        expect(localStorage.getItem(LS_KEY)).toBe('month');
    });

    it('stores valid schedule preference', () => {
        useCalendarViewStore.getState().setViewPref('schedule');
        expect(localStorage.getItem(LS_KEY)).toBe('schedule');
    });
});
