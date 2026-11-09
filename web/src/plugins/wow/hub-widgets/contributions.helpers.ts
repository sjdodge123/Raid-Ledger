/**
 * ROK-2148 — copy and pure formatting for the Guild contributions card
 * (mockup `planning-artifacts/ROK-2148-guild-contributions-mockup.html`,
 * approved as drawn 2026-11-08).
 */
export type ContributionsPeriod = '30' | 'all';

export const PERIOD_OPTIONS = [
    { value: '30', label: '30 days' },
    { value: 'all', label: 'All time' },
] as const satisfies readonly { value: ContributionsPeriod; label: string }[];

export const MASTERS_EMPTY = 'No guild template yet. A guild officer can publish one in Mailworthy.';
export const GIVERS_EMPTY_30 = 'No guild-rule mail yet this month.';
export const GIVERS_EMPTY_ALL = 'No guild-rule mail yet.';
export const GIVERS_EMPTY_HINT = "Send to a profession master with Mailworthy and you'll show up here.";
export const GIVERS_ENCOURAGE = "Send your mats through Mailworthy's guild rules to appear here.";
export const USERS_EMPTY = "Nobody's Mailworthy has said hello in the last 60 days.";
export const NOT_ON_ROSTER = 'not on roster';
/** Names shown before "Show all N" (spec E.2). */
export const USERS_PREVIEW = 12;

/** `7452` → `7,452`. */
export function formatCount(n: number): string {
    return n.toLocaleString('en-US');
}

/** `2026-08-14T…` → `14 Aug 2026`. */
export function formatDay(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Meter width relative to the period's top giver. */
export function meterPct(items: number, top: number): number {
    return top > 0 ? (items / top) * 100 : 0;
}

/** The givers header: "items given this month" / "items given since 14 Aug 2026". */
export function totalSuffix(period: ContributionsPeriod, countingSince: string | null): string {
    if (period === '30') return 'items given this month';
    return countingSince === null ? 'items given so far' : `items given since ${formatDay(countingSince)}`;
}
