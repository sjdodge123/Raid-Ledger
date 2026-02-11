import { create } from 'zustand';
import { updatePreference } from '../lib/api-client';
import { getAuthToken } from '../hooks/use-auth';
import { TIMEZONE_AUTO, getBrowserTimezone } from '../constants/timezones';

const LS_TIMEZONE_KEY = 'raid_ledger_timezone';

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
    return localStorage.getItem(LS_TIMEZONE_KEY) ?? TIMEZONE_AUTO;
}

export const useTimezoneStore = create<TimezoneState>((set) => {
    const initialId = initTimezoneId();

    return {
        timezoneId: initialId,
        resolved: resolveTimezone(initialId),

        setTimezone(id: string) {
            localStorage.setItem(LS_TIMEZONE_KEY, id);
            syncToServer(id);
            set({
                timezoneId: id,
                resolved: resolveTimezone(id),
            });
        },
    };
});
