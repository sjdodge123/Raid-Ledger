/**
 * ROK-1921 — pure helpers for the WoW: Forever Class breakdown (W1) and Level
 * progression (W2) hub widgets.
 */
import type { HubFactFreshness, WowRosterInsightsDto } from '@raid-ledger/contract';

/** Past this age the freshness footer switches to the warning tone (spec §2.3). */
export const STALE_AFTER_MS = 14 * 86_400_000;

/** A roster row with a known level, for the "top 5" list. */
export interface LeveledMember {
    name: string;
    characterId: string | null;
    level: number;
}

/** Whether the roster has any row to chart; an empty roster hides the widget. */
export function hasRoster(insights: WowRosterInsightsDto | undefined): boolean {
    return insights !== undefined && insights.classes.some((c) => c.count > 0);
}

/** The `n` highest-level roster rows, highest first (roster order breaks ties). */
export function topLeveled(insights: WowRosterInsightsDto, n = 5): LeveledMember[] {
    const rows: LeveledMember[] = [];
    for (const c of insights.classes) {
        for (const m of c.members) if (m.level !== null) rows.push({ name: m.name, characterId: m.characterId, level: m.level });
    }
    return rows.sort((a, b) => b.level - a.level).slice(0, n);
}

/** "Level 60" for a one-level bucket, else "Levels 10–19". */
export function bucketLabel(from: number, to: number): string {
    return from === to ? `Level ${from}` : `Levels ${from}–${to}`;
}

/** Short axis label: "60" or "10–19". */
export function bucketAxis(from: number, to: number): string {
    return from === to ? `${from}` : `${from}–${to}`;
}

/** "1 member" / "2 members". */
export function memberCount(n: number): string {
    return `${n} ${n === 1 ? 'member' : 'members'}`;
}

/** The display name of a fact source; a guild roster export comes from LedgerLink. */
export function sourceLabel(source: HubFactFreshness['source']): string {
    if (source === 'blizzard') return 'Blizzard';
    if (source === 'manual') return 'manual entry';
    return 'LedgerLink';
}

/** Whether `asOf` is older than the stale window. Unknown age is not stale. */
export function isStale(asOf: string | null, now: number = Date.now()): boolean {
    return asOf !== null && now - new Date(asOf).getTime() > STALE_AFTER_MS;
}
