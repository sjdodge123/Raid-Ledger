/**
 * The calendar providers the member page ships (ROK-1598): Google and Apple
 * iCloud. Microsoft stays hidden until its story (ROK-669 Q13), so its
 * connections never render even if the server lists one.
 */
import type { CalendarConnection, CalendarProvider } from '@raid-ledger/contract';

export const SHIPPED_CALENDAR_PROVIDERS = ['google', 'apple'] as const satisfies readonly CalendarProvider[];

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
 * to the dedicated "Raid Ledger" calendar (ROK-1598 A9/Q3).
 */
export function supportsPrimaryWrite(provider: CalendarProvider): boolean {
    return provider === 'google';
}
