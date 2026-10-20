/**
 * ROK-1598 — factories for Apple iCloud calendar connections.
 */
import type { CalendarConnection } from '@raid-ledger/contract';

/** A healthy Apple connection, as `GET /users/me/calendars` lists it (read on from the first connect, D10). */
export function buildAppleConnection(over: Partial<CalendarConnection> = {}): CalendarConnection {
    return {
        id: 21,
        provider: 'apple',
        accountLabel: 'raider@icloud.com',
        status: 'active',
        lastSyncedAt: null,
        errorCode: null,
        readAccess: 'granted',
        read: { enabled: true, calendarIds: [] },
        write: { enabled: false, target: 'dedicated' },
        ...over,
    };
}
