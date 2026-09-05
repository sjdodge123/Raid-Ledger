/**
 * ROK-1374 (C1) — the two pure decisions inside the readiness card.
 *
 * `estimateDownloadMinutes` is the one place the card does arithmetic, and the
 * one place it can lie. A missing input must propagate as `null` ("we don't
 * know"), never as `0` — "~0 min" reads as "instant" and would push the group
 * toward the wrong game. `canPickTie` is the row-scoped authorisation the card
 * renders the Pick button from (D15/D16).
 */
import { canPickTie, estimateDownloadMinutes } from './tie-readiness.helpers';
import * as schema from '../../drizzle/schema';

type LineupRow = typeof schema.communityLineups.$inferSelect;

const GB = 1_000_000_000;

function lineupCreatedBy(userId: number): LineupRow {
  return { createdBy: userId } as LineupRow;
}

describe('estimateDownloadMinutes', () => {
  const cases: [string, number | null, number | null, number | null][] = [
    ['no size and no speed', null, null, null],
    ['a speed but no size', null, 100, null],
    ['a size but no speed', 46 * GB, null, null],
    ['a zero speed (never divide by it)', 46 * GB, 0, null],
    ['a negative speed', 46 * GB, -50, null],
    ['46 GB on a 100 Mbps line', 46 * GB, 100, 61],
    ['46 GB on a 1000 Mbps line', 46 * GB, 1000, 6],
    ['a 1 MB patch on gigabit rounds UP to 1, never 0', 1_000_000, 1000, 1],
  ];

  it.each(cases)('%s', (_label, bytes, mbps, expected) => {
    expect(estimateDownloadMinutes(bytes, mbps)).toBe(expected);
  });

  it('never returns 0 for any positive size on any positive line', () => {
    for (const mbps of [1, 50, 940, 10_000]) {
      for (const bytes of [1, 1_000, 1_000_000, 46 * GB]) {
        const minutes = estimateDownloadMinutes(bytes, mbps);
        expect(minutes).not.toBe(0);
        expect(minutes).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('canPickTie', () => {
  it('lets the lineup creator pick even as a plain member', () => {
    expect(
      canPickTie(lineupCreatedBy(7), { id: 7, role: 'member' }),
    ).toBe(true);
  });

  it('lets an operator who did not create the lineup pick', () => {
    expect(
      canPickTie(lineupCreatedBy(7), { id: 99, role: 'operator' }),
    ).toBe(true);
  });

  it('lets an admin who did not create the lineup pick', () => {
    expect(canPickTie(lineupCreatedBy(7), { id: 99, role: 'admin' })).toBe(
      true,
    );
  });

  it('refuses a plain roster voter — first-click-wins was rejected', () => {
    expect(canPickTie(lineupCreatedBy(7), { id: 99, role: 'member' })).toBe(
      false,
    );
  });
});
