/**
 * The calendar providers the member page ships: Google, Apple iCloud
 * (ROK-1598) and Outlook / Microsoft 365 (ROK-1597).
 */
import type { CalendarConnection, CalendarProvider } from '@raid-ledger/contract';

export const SHIPPED_CALENDAR_PROVIDERS = ['google', 'microsoft', 'apple'] as const satisfies readonly CalendarProvider[];

function isShipped(provider: CalendarProvider): boolean {
    return SHIPPED_CALENDAR_PROVIDERS.some((p) => p === provider);
}

/** The connections the page lists, in server order. */
export function shippedConnections(connections: readonly CalendarConnection[]): CalendarConnection[] {
    return connections.filter((c) => isShipped(c.provider));
}

/** How many of `connections` belong to `provider`. */
export function countOf(connections: readonly CalendarConnection[], provider: CalendarProvider): number {
    return connections.filter((c) => c.provider === provider).length;
}

/**
 * Whether sign-ups can go to the account's main calendar. Apple writes only
 * to the dedicated "Raid Ledger" calendar (ROK-1598 A9/Q3). Outlook writes to
 * the main calendar too (ROK-1597 §8 Q4, Lead ruling).
 */
export function supportsPrimaryWrite(provider: CalendarProvider): boolean {
    return provider === 'google' || provider === 'microsoft';
}
