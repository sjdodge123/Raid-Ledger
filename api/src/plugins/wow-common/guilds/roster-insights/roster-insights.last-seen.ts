/**
 * ROK-1916 (W9 "Last seen") — pure presence aggregation over the roster's
 * stored guild-export presence. No I/O. Stored values are verbatim wire
 * values (spec D3); this is the one place that normalises them for display.
 */
import {
  MAX_LAST_SEEN_AWAY,
  MAX_LAST_SEEN_ONLINE,
  type WowRosterLastSeenDto,
} from '@raid-ledger/contract';
import type { InsightRow } from './roster-insights.types';

/** The roster-row fields presence needs. */
export type LastSeenRow = Pick<
  InsightRow,
  'name' | 'characterId' | 'rankIndex' | 'onlineAtExport' | 'lastOnlineDays'
>;

const byName = (a: LastSeenRow, b: LastSeenRow): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Roster order: rank ascending (null ranks last), then name. */
function byRoster(a: LastSeenRow, b: LastSeenRow): number {
  const ra = a.rankIndex ?? Number.MAX_SAFE_INTEGER;
  const rb = b.rankIndex ?? Number.MAX_SAFE_INTEGER;
  return ra !== rb ? ra - rb : byName(a, b);
}

/** Offline rows that carry a day count, most days first, ties by name. */
function awayRows(rows: readonly LastSeenRow[]): WowRosterLastSeenDto['away'] {
  return rows
    .flatMap((r) =>
      r.onlineAtExport === false && r.lastOnlineDays !== null
        ? [{ row: r, days: r.lastOnlineDays }]
        : [],
    )
    .sort((a, b) => b.days - a.days || byName(a.row, b.row))
    .slice(0, MAX_LAST_SEEN_AWAY)
    .map(({ row, days }) => ({
      name: row.name,
      characterId: row.characterId,
      days,
    }));
}

/**
 * The members-only `lastSeen` section (spec D5): `reported` = rows whose
 * export carried presence; `online` = online rows in roster order (capped);
 * `away` = longest-offline rows (capped). Online wins over any day count (D3).
 */
export function computeLastSeen(
  rows: readonly LastSeenRow[],
): WowRosterLastSeenDto {
  const online = rows.filter((r) => r.onlineAtExport === true);
  return {
    reported: rows.filter((r) => r.onlineAtExport !== null).length,
    onlineCount: online.length,
    online: [...online]
      .sort(byRoster)
      .slice(0, MAX_LAST_SEEN_ONLINE)
      .map((r) => ({ name: r.name, characterId: r.characterId })),
    away: awayRows(rows),
  };
}
