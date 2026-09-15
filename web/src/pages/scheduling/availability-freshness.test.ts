/**
 * ROK-1560 — pure helpers behind the poll heatmap section: the viewer-stale
 * predicate (server verdict first) and the uncovered-cell fill.
 */
import { describe, it, expect } from 'vitest';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { fillUnknownCells, isViewerStale } from './availability-freshness';

function data(overrides: Partial<AggregateGameTimeResponse> = {}): AggregateGameTimeResponse {
  return {
    eventId: 1,
    totalUsers: 9,
    cells: [{ dayOfWeek: 1, hour: 20, availableCount: 3, totalCount: 9, staleCount: 2, unknownCount: 4 }],
    totalMembers: 9,
    freshnessDays: 7,
    untemplatedMembers: 4,
    viewerGameTimeAgeDays: 0,
    ...overrides,
  } as AggregateGameTimeResponse;
}

describe('isViewerStale', () => {
  it('uses the server verdict when present', () => {
    expect(isViewerStale(7, 7, true)).toBe(true);
    expect(isViewerStale(30, 7, false)).toBe(false);
  });
  it('falls back to the day rule when the server sent no verdict', () => {
    expect(isViewerStale(null, 7)).toBe(true);
    expect(isViewerStale(8, 7)).toBe(true);
    expect(isViewerStale(7, 7)).toBe(false);
    expect(isViewerStale(undefined, 7)).toBe(false);
  });
});

describe('fillUnknownCells', () => {
  it('fills every uncovered cell as 0 free · N unknown when members are untemplated', () => {
    const cells = fillUnknownCells(data());
    expect(cells).toHaveLength(7 * 24);
    const covered = cells.find((c) => c.dayOfWeek === 1 && c.hour === 20);
    expect(covered).toMatchObject({ availableCount: 3, staleCount: 2, unknownCount: 4 });
    const uncovered = cells.find((c) => c.dayOfWeek === 0 && c.hour === 3);
    expect(uncovered).toEqual({
      dayOfWeek: 0, hour: 3, availableCount: 0, totalCount: 9, staleCount: 0, unknownCount: 4,
    });
  });
  it('returns the cells untouched when nobody is untemplated', () => {
    const d = data({ untemplatedMembers: 0 });
    expect(fillUnknownCells(d)).toBe(d.cells);
  });
  it('returns the cells untouched for an aggregate without the freshness model (events)', () => {
    const d = data({ freshnessDays: undefined, untemplatedMembers: undefined, totalMembers: undefined });
    expect(fillUnknownCells(d)).toBe(d.cells);
  });
});
