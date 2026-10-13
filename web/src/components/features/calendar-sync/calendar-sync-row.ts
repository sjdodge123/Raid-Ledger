/** Calendars render inline on My Integrations (ROK-1780); the OAuth callback lands here too. */
export const CALENDARS_PATH = '/profile/integrations';

/** K5's route prefix, under My Integrations since ROK-1780. */
export const SEND_EVENTS_BASE = '/profile/integrations/calendars/send';

/** Shared row frame for the provider row and the connected card (K1/K2 `prov`). */
export const CALENDAR_ROW =
    'flex items-center gap-3 rounded-lg border border-edge bg-panel px-3 py-3 min-h-[64px]';

/** K5 phone page: `/profile/integrations/calendars/send/:connectionId` (ROK-1596 W1b, moved ROK-1780). */
export function sendEventsPath(connectionId: number): string {
    return `${SEND_EVENTS_BASE}/${connectionId}`;
}
