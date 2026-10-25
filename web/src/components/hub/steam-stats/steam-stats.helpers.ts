/**
 * ROK-1953 §5.1 — pure helpers for the Core Steam cards (Achievement race,
 * Playtime): labels, the ranked rows each card draws and the footnote counts.
 * A masked achievement never carries a name (server-side, D8), so every label
 * here falls back to "Hidden achievement".
 */
import type { SteamAchievementView, SteamHubMemberStats, SteamHubUnlock } from '@raid-ledger/contract';

/** The masked-row copy (design-system §4.27 "masked hidden-achievement row"). */
export const HIDDEN_ACHIEVEMENT = 'Hidden achievement';

/** A row the race / hours list draws: one member, a value label and a meter %. */
export interface SteamStatsRow {
    member: SteamHubMemberStats;
    value: string;
    pct: number;
}

/** Lifetime Steam hours: "412 h"; under one hour reads "< 1 h". */
export function hoursLabel(minutes: number): string {
    if (minutes < 60) return '< 1 h';
    return `${Math.round(minutes / 60).toLocaleString('en-US')} h`;
}

/** A global unlock %: one decimal under 10 ("3.2%"), whole above ("89%"); `null` = unknown (""). */
export function pctLabel(pct: number | null): string {
    if (pct === null) return '';
    return pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

/** Rare = fewer than 10% of Steam players have it. */
export function isRare(pct: number | null): boolean {
    return pct !== null && pct < 10;
}

/** The achievement's visible name — "Hidden achievement" for a masked one. */
export function achievementName(view: SteamAchievementView): string {
    return view.masked ? HIDDEN_ACHIEVEMENT : view.name;
}

/** Screen-reader text for an unlock: "Hidden achievement, 3.2% of players". */
export function achievementA11y(view: SteamAchievementView): string {
    const pct = pctLabel(view.globalPct);
    return pct === '' ? achievementName(view) : `${achievementName(view)}, ${pct} of players`;
}

/** Race rows: `ok` members with a count, in the server's order, meter = share of the game's total. */
export function raceRows(members: readonly SteamHubMemberStats[], total: number): SteamStatsRow[] {
    return members.flatMap((member) => {
        if (member.status !== 'ok' || member.unlockedCount === null) return [];
        const pct = total > 0 ? (member.unlockedCount / total) * 100 : 0;
        return [{ member, value: `${member.unlockedCount} / ${total}`, pct }];
    });
}

/** Hours rows: members with playtime, most first, meter scaled to the top row. */
export function playtimeRows(members: readonly SteamHubMemberStats[]): SteamStatsRow[] {
    const withHours = members.filter((m) => m.playtimeMinutes !== null && m.playtimeMinutes > 0);
    const sorted = [...withHours].sort((a, b) => (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0));
    const top = sorted[0]?.playtimeMinutes ?? 0;
    return sorted.map((member) => {
        const minutes = member.playtimeMinutes ?? 0;
        return { member, value: hoursLabel(minutes), pct: top > 0 ? (minutes / top) * 100 : 0 };
    });
}

/** How many members have not linked Steam, and how many keep their game details private. */
export function footnoteCounts(members: readonly SteamHubMemberStats[]): { unlinked: number; private: number } {
    return {
        unlinked: members.filter((m) => m.status === 'unlinked').length,
        private: members.filter((m) => m.status === 'private').length,
    };
}

/** "2 haven't linked Steam · 1 private" — empty when nobody is missing. */
export function missingLine(members: readonly SteamHubMemberStats[], withPrivate: boolean): string {
    const counts = footnoteCounts(members);
    const parts: string[] = [];
    if (counts.unlinked > 0) parts.push(`${counts.unlinked} ${counts.unlinked === 1 ? "hasn't" : "haven't"} linked Steam`);
    if (withPrivate && counts.private > 0) parts.push(`${counts.private} private`);
    return parts.join(' · ');
}

/** Nobody on the hub has linked Steam (or the hub has no members) — the §4.5 empty sentence. */
export function nobodyLinked(members: readonly SteamHubMemberStats[]): boolean {
    return members.every((m) => m.status === 'unlinked');
}

/**
 * Stable, unique React keys for a recent-unlock list (Codex P2). Steam can
 * award one player several achievements in the same second, so
 * `userId + unlockedAt` collides. A named unlock adds its api name; a masked
 * one carries none on the wire (D8), so it adds its ordinal among that
 * player's masked unlocks in that second — the server's order
 * (`unlocked_at` desc, user, api name) keeps that ordinal stable.
 */
export function unlockKeys(unlocks: readonly SteamHubUnlock[]): string[] {
    const maskedSeen = new Map<string, number>();
    return unlocks.map((u) => {
        const base = `${u.userId}-${u.unlockedAt}`;
        if (!u.achievement.masked) return `${base}-${u.achievement.apiName}`;
        const n = maskedSeen.get(base) ?? 0;
        maskedSeen.set(base, n + 1);
        return `${base}-masked-${n}`;
    });
}
