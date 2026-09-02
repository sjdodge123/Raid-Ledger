/**
 * ROK-1463 §A — unit coverage for the PURE overlap-window helpers.
 *
 * TDD: written before the implementation, so `./lfg-overlap.helpers` does not
 * resolve yet and the new `./lfg.constants` exports do not exist. Every test in
 * this file therefore fails by construction until the dev lands:
 *
 *   `./lfg.constants`        → LFG_OVERLAP_HORIZON_DAYS (14)
 *                              LFG_OVERLAP_WINDOWS (2)
 *                              LFG_HISTORY_LIMIT (20)
 *                              LFG_SUGGESTIONS_LIMIT (12)
 *   `./lfg-overlap.helpers`  → computeHourCoverage(memberSlots)
 *                              selectOverlapHours(memberSlots)
 *                              groupIntoWindows(hours, totalCount)
 *                              rankWindows(windows, limit)
 *                              computeOverlapWindows(memberSlots, limit?)
 *                              types OverlapHour / OverlapWindow
 *
 * These functions know nothing about the DB. The caller resolves the grid
 * (`game_time_templates` + overrides + absences) and the tsrange rows into
 * `Map<userId, Set<hourStartIso>>` — one entry per LIVE member, whose set may
 * be empty — and these helpers do the set arithmetic.
 */
import {
  LFG_HISTORY_LIMIT,
  LFG_OVERLAP_HORIZON_DAYS,
  LFG_OVERLAP_WINDOWS,
  LFG_SUGGESTIONS_LIMIT,
} from './lfg.constants';
import {
  computeHourCoverage,
  computeOverlapWindows,
  groupIntoWindows,
  rankWindows,
  selectOverlapHours,
  type OverlapHour,
  type OverlapWindow,
} from './lfg-overlap.helpers';

/** Monday 2026-09-07 00:00 UTC — a fixed base keeps every hour key literal. */
const BASE = Date.UTC(2026, 8, 7);
const HOUR_MS = 60 * 60 * 1000;

/** ISO hour-start key `n` hours after the base instant. */
const H = (n: number): string => new Date(BASE + n * HOUR_MS).toISOString();

/** Build the `Map<userId, Set<hourStartIso>>` the helpers consume. */
function slots(entries: Array<[number, string[]]>): Map<number, Set<string>> {
  return new Map(entries.map(([id, hours]) => [id, new Set(hours)]));
}

/** Build an expected window. `length` is in hours. */
function win(
  startHour: number,
  length: number,
  members: number[],
  totalCount = members.length,
): OverlapWindow {
  return {
    start: H(startHour),
    end: H(startHour + length),
    availableCount: members.length,
    totalCount,
    members,
  };
}

const byId = (a: number, b: number) => a - b;

// ═══════════════════════════════════════════════════════════════════════════
// coverage
// ═══════════════════════════════════════════════════════════════════════════

describe('computeHourCoverage', () => {
  it('maps each hour to the member ids that hold it, ascending', () => {
    const coverage = computeHourCoverage(
      slots([
        [7, [H(18), H(19)]],
        [3, [H(19)]],
      ]),
    );

    expect([...coverage.get(H(19))!].sort(byId)).toEqual([3, 7]);
    expect(coverage.get(H(18))).toEqual([7]);
    expect(coverage.size).toBe(2);
  });

  it('produces no hours for members with an empty slot set', () => {
    const coverage = computeHourCoverage(
      slots([
        [1, []],
        [2, []],
      ]),
    );

    expect(coverage.size).toBe(0);
  });

  it('counts a member once per hour even when the same hour repeats', () => {
    // A Set cannot hold duplicates, but two members must not be conflated
    // either — this pins "coverage is a member count, not a slot count".
    const coverage = computeHourCoverage(
      slots([
        [1, [H(20)]],
        [2, [H(20)]],
        [3, [H(20)]],
      ]),
    );

    expect(coverage.get(H(20))).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// hour selection — full overlap, then the ≥2 fallback
// ═══════════════════════════════════════════════════════════════════════════

describe('selectOverlapHours', () => {
  it('keeps only the hours every member shares', () => {
    const hours = selectOverlapHours(
      slots([
        [1, [H(20), H(21), H(22)]],
        [2, [H(20), H(21)]],
        [3, [H(20), H(21), H(23)]],
      ]),
    );

    expect(hours.map((h) => h.start)).toEqual([H(20), H(21)]);
    expect(hours.every((h) => h.members.length === 3)).toBe(true);
  });

  it('falls back to the maximum coverage when no hour is shared by all', () => {
    const hours = selectOverlapHours(
      slots([
        [1, [H(20), H(21)]],
        [2, [H(20), H(21)]],
        [3, [H(23)]],
      ]),
    );

    expect(hours.map((h) => h.start)).toEqual([H(20), H(21)]);
    expect(hours.map((h) => [...h.members].sort(byId))).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  it('drops lower-coverage hours when falling back', () => {
    // H(30) is held by 3 of 4; H(31) by only 2. Max coverage wins outright.
    const hours = selectOverlapHours(
      slots([
        [1, [H(30), H(31)]],
        [2, [H(30), H(31)]],
        [3, [H(30)]],
        [4, [H(40)]],
      ]),
    );

    expect(hours.map((h) => h.start)).toEqual([H(30)]);
    expect([...hours[0].members].sort(byId)).toEqual([1, 2, 3]);
  });

  it('returns nothing when the best coverage is a single member', () => {
    expect(
      selectOverlapHours(
        slots([
          [1, [H(10)]],
          [2, [H(20)]],
          [3, [H(30)]],
        ]),
      ),
    ).toEqual([]);
  });

  it('returns nothing for fewer than two members', () => {
    expect(selectOverlapHours(slots([[1, [H(10), H(11)]]]))).toEqual([]);
    expect(selectOverlapHours(slots([]))).toEqual([]);
  });

  it('returns hours sorted ascending by start regardless of insertion order', () => {
    const hours = selectOverlapHours(
      slots([
        [1, [H(30), H(10), H(20)]],
        [2, [H(20), H(30), H(10)]],
      ]),
    );

    expect(hours.map((h) => h.start)).toEqual([H(10), H(20), H(30)]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// grouping consecutive hours
// ═══════════════════════════════════════════════════════════════════════════

describe('groupIntoWindows', () => {
  const hour = (n: number, members: number[]): OverlapHour => ({
    start: H(n),
    members,
  });

  it('merges consecutive hours into one window ending an hour after the last', () => {
    const windows = groupIntoWindows(
      [hour(19, [1, 2]), hour(20, [1, 2]), hour(21, [1, 2])],
      2,
    );

    expect(windows).toEqual([win(19, 3, [1, 2])]);
  });

  it('splits on a gap between hours', () => {
    const windows = groupIntoWindows([hour(19, [1, 2]), hour(22, [1, 2])], 2);

    expect(windows).toEqual([win(19, 1, [1, 2]), win(22, 1, [1, 2])]);
  });

  it('splits when the member set changes between consecutive hours', () => {
    // Fallback coverage can hand back adjacent hours held by DIFFERENT pairs.
    // Merging them would report a window nobody can actually all attend.
    const windows = groupIntoWindows([hour(19, [1, 2]), hour(20, [1, 3])], 3);

    expect(windows).toEqual([win(19, 1, [1, 2], 3), win(20, 1, [1, 3], 3)]);
  });

  it('carries the supplied roster size as totalCount', () => {
    const [window] = groupIntoWindows([hour(19, [1, 2])], 5);

    expect(window.availableCount).toBe(2);
    expect(window.totalCount).toBe(5);
  });

  it('returns nothing for an empty hour list', () => {
    expect(groupIntoWindows([], 3)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ranking + cap
// ═══════════════════════════════════════════════════════════════════════════

describe('rankWindows', () => {
  const wide = win(20, 1, [1, 2, 3]);
  const long = win(30, 3, [1, 2]);
  const early = win(5, 1, [1, 2]);
  const late = win(10, 1, [1, 2]);

  it('ranks by coverage desc, then length desc, then start asc', () => {
    const ranked = rankWindows([late, early, long, wide], 10);

    expect(ranked).toEqual([wide, long, early, late]);
  });

  it('caps the result at the supplied limit', () => {
    expect(rankWindows([late, early, long, wide], 2)).toEqual([wide, long]);
  });

  it('does not mutate its input', () => {
    const input = [late, early, long, wide];
    rankWindows(input, 2);

    expect(input).toEqual([late, early, long, wide]);
  });

  it('returns an empty list when given none', () => {
    expect(rankWindows([], 2)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// end-to-end pipeline
// ═══════════════════════════════════════════════════════════════════════════

describe('computeOverlapWindows', () => {
  it('returns the shared block as a single full-overlap window', () => {
    const windows = computeOverlapWindows(
      slots([
        [1, [H(19), H(20)]],
        [2, [H(19), H(20)]],
      ]),
    );

    expect(windows).toEqual([win(19, 2, [1, 2])]);
  });

  it('reports the roster size as totalCount on the fallback path', () => {
    const windows = computeOverlapWindows(
      slots([
        [1, [H(19), H(20)]],
        [2, [H(19), H(20)]],
        [3, []],
      ]),
    );

    expect(windows).toEqual([win(19, 2, [1, 2], 3)]);
  });

  it('returns no windows for fewer than two live members', () => {
    expect(computeOverlapWindows(slots([[1, [H(19), H(20)]]]))).toEqual([]);
  });

  it('returns no windows when no member has any availability', () => {
    expect(
      computeOverlapWindows(
        slots([
          [1, []],
          [2, []],
        ]),
      ),
    ).toEqual([]);
  });

  it('defaults to the LFG_OVERLAP_WINDOWS cap', () => {
    const spread = [H(10), H(20), H(30), H(40)];
    const windows = computeOverlapWindows(
      slots([
        [1, spread],
        [2, spread],
      ]),
    );

    expect(windows).toHaveLength(LFG_OVERLAP_WINDOWS);
    expect(windows.map((w) => w.start)).toEqual([H(10), H(20)]);
  });

  it('honours an explicit limit over the default', () => {
    const spread = [H(10), H(20), H(30)];
    const windows = computeOverlapWindows(
      slots([
        [1, spread],
        [2, spread],
      ]),
      3,
    );

    expect(windows.map((w) => w.start)).toEqual([H(10), H(20), H(30)]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// constants pinned by the spec
// ═══════════════════════════════════════════════════════════════════════════

describe('read constants', () => {
  it.each([
    ['LFG_OVERLAP_HORIZON_DAYS', LFG_OVERLAP_HORIZON_DAYS, 14],
    ['LFG_OVERLAP_WINDOWS', LFG_OVERLAP_WINDOWS, 2],
    ['LFG_HISTORY_LIMIT', LFG_HISTORY_LIMIT, 20],
    ['LFG_SUGGESTIONS_LIMIT', LFG_SUGGESTIONS_LIMIT, 12],
  ])('%s is %i', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });
});
