/**
 * ROK-1710 — the re-arm rule applied by an explicit target edit.
 *
 * Unit-level: the db is a recording fake, the cap loader is mocked. The real
 * end-to-end behaviour is covered by
 * `lineup-nomination-target-edit.integration.spec.ts`.
 */
import {
  applyNominationTargetEdit,
  isNominationTargetEditNoop,
} from './nomination-target.helpers';
import { loadEffectiveNominationCapById } from '../lineups-nomination-cap.helpers';
import type * as schema from '../../drizzle/schema';

jest.mock('../lineups-nomination-cap.helpers', () => ({
  loadEffectiveNominationCap: jest.fn(),
  loadEffectiveNominationCapById: jest.fn(),
}));

const capMock = loadEffectiveNominationCapById as jest.MockedFunction<
  typeof loadEffectiveNominationCapById
>;

type LineupRow = typeof schema.communityLineups.$inferSelect;

function row(overrides: Partial<LineupRow>): LineupRow {
  return {
    id: 1,
    nominationTargetPct: 25,
    nominationTargetDisarmedAt: null,
    nominationTargetBelowSeenAt: null,
    ...overrides,
  } as LineupRow;
}

/** Records every `.set()` payload; `select` resolves `entryCount` rows. */
function fakeDb(entryCount: number) {
  const sets: Record<string, unknown>[] = [];
  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        sets.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve(
            Array.from({ length: entryCount }, (_, id) => ({ id })),
          ),
      }),
    }),
  } as never;
  return { db, sets };
}

describe('isNominationTargetEditNoop', () => {
  it('is a no-op for the same pct on an armed-or-unarmed, not-disarmed lineup', () => {
    expect(isNominationTargetEditNoop(row({}), 25)).toBe(true);
  });

  it('is NOT a no-op when the pct changes', () => {
    expect(isNominationTargetEditNoop(row({}), 50)).toBe(false);
  });

  it('is NOT a no-op for the same pct on a disarmed lineup (deliberate re-arm)', () => {
    const disarmed = row({ nominationTargetDisarmedAt: new Date() });
    expect(isNominationTargetEditNoop(disarmed, 25)).toBe(false);
  });

  it('treats null -> null on a deadline-only lineup as a no-op', () => {
    expect(
      isNominationTargetEditNoop(row({ nominationTargetPct: null }), null),
    ).toBe(true);
  });
});

describe('applyNominationTargetEdit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capMock.mockResolvedValue(20);
  });

  it('writes nothing for a no-op edit', async () => {
    const { db, sets } = fakeDb(5);
    await applyNominationTargetEdit(db, row({}), 25);
    expect(sets).toEqual([]);
  });

  it('clears both stamps and arms a lineup below the new target', async () => {
    const { db, sets } = fakeDb(5); // 5/20 = 25% < 50%
    await applyNominationTargetEdit(
      db,
      row({
        nominationTargetDisarmedAt: new Date(),
        nominationTargetBelowSeenAt: new Date(),
      }),
      50,
    );
    expect(sets[0]).toMatchObject({
      nominationTargetPct: 50,
      nominationTargetDisarmedAt: null,
      nominationTargetBelowSeenAt: null,
    });
    expect(sets).toHaveLength(2);
    expect(sets[1]?.nominationTargetBelowSeenAt).toBeInstanceOf(Date);
  });

  it('leaves a lineup at/above the new target unarmed (standing condition)', async () => {
    const { db, sets } = fakeDb(5); // 5/20 = 25% >= 25%
    await applyNominationTargetEdit(
      db,
      row({ nominationTargetDisarmedAt: new Date() }),
      25,
    );
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      nominationTargetDisarmedAt: null,
      nominationTargetBelowSeenAt: null,
    });
  });

  it('turns the target off with null and never runs the arm check', async () => {
    const { db, sets } = fakeDb(0);
    await applyNominationTargetEdit(
      db,
      row({ nominationTargetDisarmedAt: new Date() }),
      null,
    );
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      nominationTargetPct: null,
      nominationTargetDisarmedAt: null,
    });
    expect(capMock).not.toHaveBeenCalled();
  });
});
