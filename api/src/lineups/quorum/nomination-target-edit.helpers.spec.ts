/**
 * ROK-1710 — the re-arm rule applied by an explicit target edit.
 *
 * Unit-level: the db is a recording fake, the cap loader is mocked. The real
 * end-to-end behaviour is covered by
 * `lineup-nomination-target-edit.integration.spec.ts`.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ConflictException } from '@nestjs/common';
import {
  applyNominationTargetEdit,
  evaluateNominationTarget,
  isNominationTargetEditNoop,
  PENDING_ADVANCE_EDIT_MESSAGE,
} from './nomination-target.helpers';
import {
  loadEffectiveNominationCap,
  loadEffectiveNominationCapById,
} from '../lineups-nomination-cap.helpers';
import type * as schema from '../../drizzle/schema';

jest.mock('../lineups-nomination-cap.helpers', () => ({
  loadEffectiveNominationCap: jest.fn(),
  loadEffectiveNominationCapById: jest.fn(),
}));

const capMock = loadEffectiveNominationCapById as jest.MockedFunction<
  typeof loadEffectiveNominationCapById
>;

const evalCapMock = loadEffectiveNominationCap as jest.MockedFunction<
  typeof loadEffectiveNominationCap
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

/**
 * Records every `.set()` payload and its WHERE; `select` resolves
 * `entryCount` rows.
 */
function fakeDb(entryCount: number, opts: { claimed?: boolean } = {}) {
  const sets: Record<string, unknown>[] = [];
  const wheres: (SQL | undefined)[] = [];
  // `.returning()` answers the target UPDATE: no row once a claim landed.
  const returned = opts.claimed ? [] : [{ id: 1 }];
  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        sets.push(values);
        return {
          where: (cond: SQL | undefined) => {
            wheres.push(cond);
            return Object.assign(Promise.resolve(), {
              returning: () => Promise.resolve(returned),
            });
          },
        };
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
  return { db, sets, wheres };
}

/** Render a recorded WHERE to SQL text + params; a missing one fails loudly. */
function renderWhere(cond: SQL | undefined): {
  sql: string;
  params: unknown[];
} {
  if (!cond) throw new Error('expected a recorded WHERE condition');
  return new PgDialect().sqlToQuery(cond);
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

  it('writes only while no early advance is pending, else 409 (Codex round 3)', async () => {
    const { db, sets, wheres } = fakeDb(10, { claimed: true });
    const err = await applyNominationTargetEdit(
      db,
      row({ nominationTargetPct: 50 }),
      55,
    ).catch((e: unknown) => e);
    expect(renderWhere(wheres[0]).sql).toContain(
      '"pending_advance_at" is null',
    );
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(
      PENDING_ADVANCE_EDIT_MESSAGE,
    );
    // The arm check never ran: one UPDATE, and it did not claim the edit.
    expect(sets).toHaveLength(1);
    expect(sets[0]).not.toHaveProperty('pendingAdvanceAt');
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

describe('below-seen stamp is pinned to the judged state (ROK-1710 race guard)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    evalCapMock.mockResolvedValue(20);
    capMock.mockResolvedValue(20);
  });

  it('a nomination arms only while the target it judged is still set and undisarmed', async () => {
    const { db, sets, wheres } = fakeDb(0);
    // 8/20 = 40% < 75%: below target, so evaluate stamps the rising edge.
    const res = await evaluateNominationTarget(
      db,
      row({ nominationTargetPct: 75 }),
      8,
      1,
    );
    expect(res.ready).toBe(false);
    expect(sets).toHaveLength(1);
    const where = renderWhere(wheres[0]);
    // An edit that landed after this row was read changes the pct (or a
    // revert sets the disarm), so the stale stamp matches no row.
    expect(where.sql).toMatch(/"nomination_target_pct" = \$\d/);
    expect(where.sql).toMatch(/"nomination_target_disarmed_at" is null/);
    expect(where.sql).toMatch(/"nomination_target_below_seen_at" is null/);
    expect(where.params).toContain(75);
  });

  it('the edit-time arm check is pinned to the NEW target', async () => {
    const { db, wheres } = fakeDb(5); // 5/20 = 25% < 50%
    await applyNominationTargetEdit(
      db,
      row({ nominationTargetPct: 75, nominationTargetDisarmedAt: new Date() }),
      50,
    );
    expect(wheres).toHaveLength(2);
    expect(renderWhere(wheres[1]).params).toContain(50);
  });
});
