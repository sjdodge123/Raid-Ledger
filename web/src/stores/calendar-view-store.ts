import { create } from 'zustand';
import { updatePreference } from '../lib/api-client';
import { getAuthToken } from '../hooks/use-auth';
import { safeGetItem, safeRemoveItem, safeSetItem } from '../lib/safe-storage';

export type CalendarViewPref = 'schedule' | 'week' | 'month' | 'day';

const DEFAULT_VIEW: CalendarViewPref =
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'schedule' : 'week';
const LS_KEY = 'raid_ledger_calendar_view';
const LEGACY_KEY = 'calendar-view';

const VALID: Set<string> = new Set(['schedule', 'week', 'month', 'day']);

function syncToServer(view: CalendarViewPref) {
    if (getAuthToken()) {
        updatePreference('calendarView', view).catch(() => {
            // Fire-and-forget — silent failure for offline/unauth
        });
    }
}

function initViewPref(): CalendarViewPref {
    // 1. Check new key
    const stored = safeGetItem(LS_KEY);
    if (stored && VALID.has(stored)) return stored as CalendarViewPref;

    // 2. Migrate from legacy key
    const legacy = safeGetItem(LEGACY_KEY);
    if (legacy && VALID.has(legacy)) {
        safeSetItem(LS_KEY, legacy);
        safeRemoveItem(LEGACY_KEY);
        return legacy as CalendarViewPref;
    }

    // 3. Default
    return DEFAULT_VIEW;
}

interface CalendarViewState {
    viewPref: CalendarViewPref;
    setViewPref: (view: CalendarViewPref) => void;
}

export const useCalendarViewStore = create<CalendarViewState>((set) => {
    const initial = initViewPref();

    return {
        viewPref: initial,

        setViewPref(view: CalendarViewPref) {
            safeSetItem(LS_KEY, view);
            syncToServer(view);
            set({ viewPref: view });
        },
    };
});
