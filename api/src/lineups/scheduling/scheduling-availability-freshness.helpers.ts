/**
 * Fresh / stale / unknown cell model for the scheduling-poll heatmap (ROK-1560).
 *
 * Fill = fresh availability, hatch = stale, and the count reads
 * `N free · M unknown`. A stale member is NEVER counted as available
 * (down-weighting was rejected in the ROK-1555 spike); a member with no
 * template at all is unknown on every cell, while a member WITH a template
 * that does not cover a cell is known-busy, not unknown.
 */
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { isGameTimeStale } from '../../users/game-time-freshness.helpers';
import { templateDayToGridDay } from '../../users/game-time-heatmap.helpers';

/** A poll member with their game-time confirmation state. */
export interface FreshnessMember {
  userId: number;
  confirmedAt: Date | null;
  hasTemplate: boolean;
}

/** Member ids bucketed by game-time freshness. Buckets are mutually exclusive. */
export interface FreshnessSplit {
  freshIds: number[];
  staleIds: number[];
  untemplatedIds: number[];
}

/** A template row keyed by member (template day convention: 0 = Monday). */
export interface FreshnessTemplateRow {
  userId: number;
  dayOfWeek: number;
  startHour: number;
}

type Cell = AggregateGameTimeResponse['cells'][number];

/** Split members into fresh / stale / untemplated buckets. */
export function splitMembersByFreshness(
  members: FreshnessMember[],
  now: Date = new Date(),
): FreshnessSplit {
  const split: FreshnessSplit = {
    freshIds: [],
    staleIds: [],
    untemplatedIds: [],
  };
  for (const member of members) {
    if (!member.hasTemplate) {
      split.untemplatedIds.push(member.userId);
    } else if (isGameTimeStale(member.confirmedAt, now)) {
      split.staleIds.push(member.userId);
    } else {
      split.freshIds.push(member.userId);
    }
  }
  return split;
}

/**
 * Aggregate templates into grid-convention cells carrying fresh / stale /
 * unknown counts. `totalMembers` keeps the existing shading denominator.
 */
export function aggregateFreshnessCells(
  templates: FreshnessTemplateRow[],
  split: FreshnessSplit,
  totalMembers: number,
): Cell[] {
  const fresh = new Set(split.freshIds);
  const stale = new Set(split.staleIds);
  const unknownCount = split.untemplatedIds.length;
  const cells = new Map<string, Cell>();
  for (const t of templates) {
    const dayOfWeek = templateDayToGridDay(t.dayOfWeek);
    const key = `${dayOfWeek}:${t.startHour}`;
    const cell = cells.get(key) ?? {
      dayOfWeek,
      hour: t.startHour,
      availableCount: 0,
      totalCount: totalMembers,
      staleCount: 0,
      // Same on every cell: a member with no template is unknown EVERYWHERE
      // (= the response's `untemplatedMembers`); the web fills the uncovered
      // cells with this count too.
      unknownCount,
    };
    if (fresh.has(t.userId)) cell.availableCount += 1;
    else if (stale.has(t.userId)) cell.staleCount = (cell.staleCount ?? 0) + 1;
    cells.set(key, cell);
  }
  return Array.from(cells.values());
}
