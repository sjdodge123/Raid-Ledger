import { CALENDARS_PATH } from '../../profile/profile-nav-data';
/** Shared row frame for the provider row and the connected card (K1/K2 `prov`). */
export const CALENDAR_ROW =
    'flex items-center gap-3 rounded-lg border border-edge bg-panel px-3 py-3 min-h-[64px]';

/** K5 phone page: `/profile/gaming/calendars/send/:connectionId` (ROK-1596 W1b). */
export function sendEventsPath(connectionId: number): string {
    return `${CALENDARS_PATH}/send/${connectionId}`;
}
