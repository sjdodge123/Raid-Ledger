/** ROK-1957 §9.1 U-3 — the retention plan (D-9, D-11). */
import { BG3_RETENTION_DAYS } from '../bg3.constants';
import {
  planRetention,
  retentionCutoff,
  type Bg3RetentionRow,
} from './bg3-retention.helpers';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = new Date('2026-06-01T05:15:00.000Z');
const CUTOFF = retentionCutoff(NOW);
const OLD = CUTOFF.getTime() - 10 * DAY;

function row(
  id: number,
  at: number,
  sha: string | null = null,
  extra: Partial<Bg3RetentionRow> = {},
): Bg3RetentionRow {
  return {
    id,
    savedAt: new Date(at),
    currentLevel: 'WLD',
    partyMaxLevel: 4,
    thumbnailSha256: sha,
    ...extra,
  };
}

describe('retentionCutoff', () => {
  it('is BG3_RETENTION_DAYS before now', () => {
    expect(NOW.getTime() - CUTOFF.getTime()).toBe(BG3_RETENTION_DAYS * DAY);
  });
});

describe('planRetention', () => {
  it('collapses an old 5-row session to its last row, stamped with first save + count', () => {
    const rows = [0, 1, 2, 3, 4].map((i) =>
      row(i + 1, OLD + i * HOUR, `s${i + 1}`),
    );
    const plan = planRetention(rows, CUTOFF);
    expect(plan.keep).toEqual([
      { id: 5, sessionFirstSavedAt: new Date(OLD), sessionSaveCount: 5 },
    ]);
    expect(plan.deleteIds).toEqual([1, 2, 3, 4]);
    expect(plan.releasedShas).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('leaves a session straddling the cutoff untouched', () => {
    const rows = [
      row(1, CUTOFF.getTime() - HOUR),
      row(2, CUTOFF.getTime() + HOUR),
    ];
    expect(planRetention(rows, CUTOFF)).toEqual({
      keep: [],
      deleteIds: [],
      releasedShas: [],
    });
  });

  it('is a no-op on an already-collapsed session (idempotent)', () => {
    const first = planRetention(
      [row(1, OLD), row(2, OLD + HOUR), row(3, OLD + 2 * HOUR)],
      CUTOFF,
    );
    const kept = first.keep[0];
    if (kept === undefined) throw new Error('first run kept nothing');
    const collapsed = row(3, OLD + 2 * HOUR, null, kept);
    expect(planRetention([collapsed], CUTOFF)).toEqual({
      keep: [],
      deleteIds: [],
      releasedShas: [],
    });
  });

  it('leaves a lone old save alone', () => {
    expect(planRetention([row(1, OLD)], CUTOFF).keep).toEqual([]);
  });

  it('folds a late save into an already-collapsed session, summing the counts', () => {
    const collapsed = row(3, OLD + 2 * HOUR, null, {
      sessionFirstSavedAt: new Date(OLD),
      sessionSaveCount: 3,
    });
    const plan = planRetention([collapsed, row(7, OLD + 3 * HOUR)], CUTOFF);
    expect(plan.keep).toEqual([
      { id: 7, sessionFirstSavedAt: new Date(OLD), sessionSaveCount: 4 },
    ]);
    expect(plan.deleteIds).toEqual([3]);
  });
});

describe('planRetention — released thumbnails', () => {
  it('does not release a sha still used by a kept or untouched row, and lists each sha once', () => {
    const rows = [
      row(1, OLD, 'shared'),
      row(2, OLD + HOUR, 'dup'),
      row(3, OLD + 2 * HOUR, 'dup'),
      row(4, OLD + 3 * HOUR, 'shared'),
      row(5, OLD + 5 * DAY, 'recent'),
      row(6, CUTOFF.getTime() + DAY, 'recent'),
    ];
    const plan = planRetention(rows, CUTOFF);
    expect(plan.deleteIds).toEqual([1, 2, 3]);
    expect(plan.releasedShas).toEqual(['dup']);
  });

  it('plans each old session of a group separately', () => {
    const rows = [
      row(1, OLD),
      row(2, OLD + HOUR),
      row(3, OLD + DAY),
      row(4, OLD + DAY + HOUR),
    ];
    const plan = planRetention(rows, CUTOFF);
    expect(plan.keep.map((k) => k.id)).toEqual([2, 4]);
    expect(plan.deleteIds).toEqual([1, 3]);
  });
});
