/**
 * ROK-1560 — fresh / stale / unknown split for the scheduling-poll heatmap.
 *
 * Pre-change these fail with "Cannot find module
 * './scheduling-availability-freshness.helpers'": the poll aggregate counted
 * every templated member as available regardless of how old their game time
 * was, so a 6-month-old template read as a confirmed "free" cell.
 */
import { GAME_TIME_FRESHNESS_DAYS } from '../../users/game-time-freshness.helpers';
import {
  splitMembersByFreshness,
  aggregateFreshnessCells,
} from './scheduling-availability-freshness.helpers';

const now = new Date('2026-09-14T12:00:00.000Z');

function daysAgo(days: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

describe('splitMembersByFreshness', () => {
  it('buckets fresh, stale, never-confirmed and untemplated members', () => {
    const split = splitMembersByFreshness(
      [
        { userId: 1, confirmedAt: daysAgo(0), hasTemplate: true },
        {
          userId: 2,
          confirmedAt: daysAgo(GAME_TIME_FRESHNESS_DAYS + 1),
          hasTemplate: true,
        },
        { userId: 3, confirmedAt: null, hasTemplate: true },
        { userId: 4, confirmedAt: daysAgo(0), hasTemplate: false },
      ],
      now,
    );

    expect(split.freshIds).toEqual([1]);
    expect(split.staleIds.sort()).toEqual([2, 3]);
    expect(split.untemplatedIds).toEqual([4]);
  });

  it('puts a member confirmed exactly GAME_TIME_FRESHNESS_DAYS days ago in fresh (matches isGameTimeStale)', () => {
    const split = splitMembersByFreshness(
      [
        {
          userId: 1,
          confirmedAt: daysAgo(GAME_TIME_FRESHNESS_DAYS),
          hasTemplate: true,
        },
      ],
      now,
    );

    expect(split.freshIds).toEqual([1]);
    expect(split.staleIds).toEqual([]);
  });

  it('never classifies an untemplated member as fresh or stale', () => {
    const split = splitMembersByFreshness(
      [{ userId: 9, confirmedAt: null, hasTemplate: false }],
      now,
    );

    expect(split).toEqual({ freshIds: [], staleIds: [], untemplatedIds: [9] });
  });
});

describe('aggregateFreshnessCells', () => {
  // Template dayOfWeek 0 = Monday; grid dayOfWeek 1 = Monday.
  const templates = [
    { userId: 1, dayOfWeek: 0, startHour: 20 },
    { userId: 2, dayOfWeek: 0, startHour: 20 },
    { userId: 1, dayOfWeek: 1, startHour: 21 },
  ];
  const split = {
    freshIds: [1],
    staleIds: [2],
    untemplatedIds: [3],
  };

  it('counts fresh as available, stale separately, untemplated as unknown', () => {
    const cells = aggregateFreshnessCells(templates, split, 3);
    const monday20 = cells.find((c) => c.dayOfWeek === 1 && c.hour === 20);

    expect(monday20).toEqual({
      dayOfWeek: 1,
      hour: 20,
      availableCount: 1,
      totalCount: 3,
      staleCount: 1,
      unknownCount: 1,
    });
  });

  it('never counts a stale member as available', () => {
    const cells = aggregateFreshnessCells(templates, split, 3);
    for (const cell of cells) {
      expect(cell.availableCount).toBeLessThanOrEqual(1);
    }
  });

  it('reports unknownCount on every cell (untemplated members are unknown everywhere)', () => {
    const cells = aggregateFreshnessCells(templates, split, 3);
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => c.unknownCount === 1)).toBe(true);
  });

  it('omits a member from a cell their template does not cover (known-busy, not unknown)', () => {
    const cells = aggregateFreshnessCells(templates, split, 3);
    const tuesday21 = cells.find((c) => c.dayOfWeek === 2 && c.hour === 21);

    expect(tuesday21).toEqual({
      dayOfWeek: 2,
      hour: 21,
      availableCount: 1,
      totalCount: 3,
      staleCount: 0,
      unknownCount: 1,
    });
  });
});
