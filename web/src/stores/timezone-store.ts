import { create } from 'zustand';
import { updatePreference } from '../lib/api-client';
import { getAuthToken } from '../hooks/use-auth';
import { TIMEZONE_AUTO, getBrowserTimezone } from '../constants/timezones';
import { safeGetItem, safeSetItem } from '../lib/safe-storage';

const LS_TIMEZONE_KEY = 'raid_ledger_timezone';

/** True for `auto` and any IANA zone this browser's `Intl` accepts. */
function isValidTimezoneId(id: string): boolean {
    if (id === TIMEZONE_AUTO) return true;
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: id });
        return true;
    } catch {
        return false;
    }
}

/** An unknown zone would make every later `Intl` call throw — fall back to auto. */
function normalizeTimezoneId(id: string | null): string {
    return id !== null && isValidTimezoneId(id) ? id : TIMEZONE_AUTO;
}

function resolveTimezone(id: string): string {
    return id === TIMEZONE_AUTO ? getBrowserTimezone() : id;
}

function syncToServer(timezoneId: string) {
    if (getAuthToken()) {
        updatePreference('timezone', timezoneId).catch(() => {
            // Fire-and-forget — silent failure for offline/unauth
        });
    }
}

interface TimezoneState {
    /** Raw preference: an IANA string or 'auto' */
    timezoneId: string;
    /** Always a concrete IANA string (resolves 'auto' → browser tz) */
    resolved: string;
    setTimezone: (id: string) => void;
}

function initTimezoneId(): string {
    return normalizeTimezoneId(safeGetItem(LS_TIMEZONE_KEY));
}

export const useTimezoneStore = create<TimezoneState>((set) => {
    const initialId = initTimezoneId();

    return {
        timezoneId: initialId,
        resolved: resolveTimezone(initialId),

        setTimezone(rawId: string) {
            const id = normalizeTimezoneId(rawId);
            safeSetItem(LS_TIMEZONE_KEY, id);
            syncToServer(id);
            set({
                timezoneId: id,
                resolved: resolveTimezone(id),
            });
        },
    };
});
