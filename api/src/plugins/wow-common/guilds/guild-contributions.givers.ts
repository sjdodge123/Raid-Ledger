import type {
  GuildContributionsGiver,
  GuildContributionsGivers,
} from '@raid-ledger/contract';
import {
  parseStoredDays,
  type RosterByKey,
} from './guild-contributions.helpers';

/**
 * ROK-2148 D.3 + round 2 — the top-givers meter, per PLAYER: a linked
 * character's alts roll up to its RL user; an unlinked character ranks on
 * its own. Givers no longer on the latest roster are dropped (D9). The
 * viewer's own row is returned separately when it ranks outside the top 10.
 */

export const TOP_GIVERS = 10;
/** Days `todayDay − 29 … todayDay` (30 inclusive) count toward "30 days". */
export const LAST_30_SPAN = 29;

export interface StoredGiver {
  nameKey: string;
  characterName: string;
  itemsAllTime: number;
  countingSince: Date;
  days: unknown;
  asOf: Date;
}

interface CharTotals {
  groupKey: string;
  characterName: string;
  characterId: string | null;
  userId: number | null;
  last30: number;
  allTime: number;
}

type Window = 'last30' | 'allTime';

/**
 * Items in the 30-day window ending `todayDay` (inclusive). A day after
 * `todayDay` (skewed clock or relayed data) never counts.
 */
export function last30Items(days: unknown, todayDay: number): number {
  const from = todayDay - LAST_30_SPAN;
  return parseStoredDays(days)
    .filter((d) => d.day >= from && d.day <= todayDay)
    .reduce((sum, d) => sum + d.items, 0);
}

function onRosterTotals(
  rows: readonly StoredGiver[],
  roster: RosterByKey,
  todayDay: number,
): CharTotals[] {
  const out: CharTotals[] = [];
  for (const row of rows) {
    const member = roster.get(row.nameKey);
    if (!member) continue;
    out.push({
      groupKey:
        member.userId === null ? `c:${row.nameKey}` : `u:${member.userId}`,
      characterName: row.characterName,
      characterId: member.characterId,
      userId: member.userId,
      last30: last30Items(row.days, todayDay),
      allTime: row.itemsAllTime,
    });
  }
  return out;
}

/** Items descending, then name ascending — the board order. */
function byItemsThenName(
  a: { items: number; characterName: string },
  b: { items: number; characterName: string },
): number {
  return b.items - a.items || a.characterName.localeCompare(b.characterName);
}

function rollUp(
  chars: readonly CharTotals[],
  window: Window,
  viewerId: number,
): Omit<GuildContributionsGiver, 'rank'>[] {
  const groups = new Map<string, CharTotals[]>();
  for (const c of chars) {
    if (c[window] <= 0) continue;
    groups.set(c.groupKey, [...(groups.get(c.groupKey) ?? []), c]);
  }
  const players: Omit<GuildContributionsGiver, 'rank'>[] = [];
  for (const members of groups.values()) {
    const ranked = members
      .map((c) => ({ ...c, items: c[window] }))
      .sort(byItemsThenName);
    const [top] = ranked;
    if (!top) continue;
    players.push({
      userId: top.userId,
      characterName: top.characterName,
      characterId: top.characterId,
      characterCount: ranked.length,
      items: ranked.reduce((sum, c) => sum + c.items, 0),
      isYou: top.userId !== null && top.userId === viewerId,
    });
  }
  return players.sort(byItemsThenName);
}

function board(
  chars: readonly CharTotals[],
  window: Window,
  viewerId: number,
): { top: GuildContributionsGiver[]; you: GuildContributionsGiver | null } {
  const ranked = rollUp(chars, window, viewerId).map((p, i) => ({
    ...p,
    rank: i + 1,
  }));
  const you = ranked.find((p) => p.isYou && p.rank > TOP_GIVERS) ?? null;
  return { top: ranked.slice(0, TOP_GIVERS), you };
}

function extremeIso(
  dates: readonly Date[],
  pick: 'min' | 'max',
): string | null {
  if (dates.length === 0) return null;
  const ms = dates.map((d) => d.getTime());
  return new Date(
    pick === 'min' ? Math.min(...ms) : Math.max(...ms),
  ).toISOString();
}

/** The givers block of the DTO (AC3, round-2 per-player meter). */
export function computeGivers(
  rows: readonly StoredGiver[],
  roster: RosterByKey,
  todayDay: number,
  viewerId: number,
): GuildContributionsGivers {
  const shown = rows.filter((r) => roster.has(r.nameKey));
  const chars = onRosterTotals(shown, roster, todayDay);
  const last30 = board(chars, 'last30', viewerId);
  const allTime = board(chars, 'allTime', viewerId);
  return {
    last30Days: last30.top,
    allTime: allTime.top,
    youLast30Days: last30.you,
    youAllTime: allTime.you,
    last30DaysTotal: chars.reduce((sum, c) => sum + c.last30, 0),
    allTimeTotal: chars.reduce((sum, c) => sum + c.allTime, 0),
    countingSince: extremeIso(
      shown.map((r) => r.countingSince),
      'min',
    ),
    asOf: extremeIso(
      shown.map((r) => r.asOf),
      'max',
    ),
  };
}
