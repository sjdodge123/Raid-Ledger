/**
 * ROK-1917 (W10 "Raid progress") — pure aggregation over stored pulls:
 * first kill, kills/wipes, the D4 near-duplicate collapse, AC5 ordering.
 */
import { MAX_RAID_PROGRESS_BOSSES } from '@raid-ledger/contract';
import {
  collapseNearDuplicates,
  computeRaidProgress,
  type RaidPull,
} from './roster-insights.raid-progress';

const T0 = Date.parse('2026-10-22T20:00:00.000Z');
const at = (s: number): Date => new Date(T0 + s * 1000);

/** A pull starting `start` s after T0, lasting 60 s. */
function pull(
  encounterId: number,
  start: number,
  success: boolean,
  extra: Partial<RaidPull> = {},
): RaidPull {
  return {
    encounterId,
    encounterName: `Boss ${encounterId}`,
    difficultyId: 9,
    startAt: at(start),
    endAt: at(start + 60),
    success,
    ...extra,
  };
}

describe('computeRaidProgress (ROK-1917)', () => {
  it('is empty when the guild has no pulls', () => {
    expect(computeRaidProgress([])).toEqual({
      bosses: [],
      killedCount: 0,
      pullCount: 0,
      lastPullAt: null,
    });
  });

  it('AC2: first kill is the earliest successful end; kills, wipes and last pull', () => {
    const out = computeRaidProgress([
      pull(663, 3000, true),
      pull(663, 0, false),
      pull(663, 1000, true),
    ]);
    expect(out.bosses).toEqual([
      {
        encounterId: 663,
        difficultyId: 9,
        difficultyLabel: '40 Player',
        name: 'Boss 663',
        firstKillAt: at(1060).toISOString(),
        kills: 2,
        wipes: 1,
        lastPullAt: at(3060).toISOString(),
      },
    ]);
    expect(out).toMatchObject({
      killedCount: 1,
      pullCount: 3,
      lastPullAt: at(3060).toISOString(),
    });
  });

  it('a wipes-only boss has no first kill and does not count as killed', () => {
    const out = computeRaidProgress([
      pull(664, 0, false),
      pull(664, 500, false),
    ]);
    expect(out.bosses[0]).toMatchObject({
      firstKillAt: null,
      kills: 0,
      wipes: 2,
    });
    expect(out.killedCount).toBe(0);
  });

  it('AC3: a kill and a wipe 1 s apart (two exporters) count once, as the kill', () => {
    const out = computeRaidProgress([pull(663, 0, false), pull(663, 1, true)]);
    expect(out.bosses[0]).toMatchObject({ kills: 1, wipes: 0 });
    expect(out.pullCount).toBe(1);
  });

  it('AC3: pulls 11 s apart are two pulls', () => {
    const out = computeRaidProgress([
      pull(663, 0, false),
      pull(663, 11, false),
    ]);
    expect(out.bosses[0]).toMatchObject({ kills: 0, wipes: 2 });
  });

  it('two difficulties of one encounter are separate rows; unmapped id → null label', () => {
    const out = computeRaidProgress([
      pull(663, 0, true),
      pull(663, 5, true, { difficultyId: 999 }),
    ]);
    expect(out.bosses.map((b) => [b.difficultyId, b.difficultyLabel])).toEqual([
      [9, '40 Player'],
      [999, null],
    ]);
    expect(out.killedCount).toBe(2);
  });

  it('names the boss after its newest pull', () => {
    const out = computeRaidProgress([
      pull(663, 0, false, { encounterName: 'Old name' }),
      pull(663, 900, false, { encounterName: 'Lucifron' }),
    ]);
    expect(out.bosses[0]?.name).toBe('Lucifron');
  });

  it('AC5: killed first by first kill, then unkilled by most wipes', () => {
    const out = computeRaidProgress([
      pull(3, 0, false),
      pull(4, 100, false),
      pull(4, 200, false),
      pull(2, 5000, true),
      pull(1, 1000, true),
    ]);
    expect(out.bosses.map((b) => b.encounterId)).toEqual([1, 2, 4, 3]);
  });

  it('caps the rows but counts every boss', () => {
    const pulls = Array.from({ length: MAX_RAID_PROGRESS_BOSSES + 5 }, (_, i) =>
      pull(i + 1, i * 100, true),
    );
    const out = computeRaidProgress(pulls);
    expect(out.bosses).toHaveLength(MAX_RAID_PROGRESS_BOSSES);
    expect(out.killedCount).toBe(MAX_RAID_PROGRESS_BOSSES + 5);
    expect(out.pullCount).toBe(MAX_RAID_PROGRESS_BOSSES + 5);
  });
});

describe('collapseNearDuplicates (D4)', () => {
  it('keeps the window anchored on the cluster’s first pull', () => {
    const out = collapseNearDuplicates([
      pull(663, 0, false),
      pull(663, 10, false),
      pull(663, 20, false),
    ]);
    expect(out.map((p) => p.startAt.getTime())).toEqual([T0, T0 + 20_000]);
  });
});
