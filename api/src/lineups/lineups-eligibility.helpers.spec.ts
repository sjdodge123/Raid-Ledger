/**
 * Unit tests for private-lineup eligibility (ROK-1065).
 */
import { ForbiddenException } from '@nestjs/common';
import * as schema from '../drizzle/schema';
import {
  assertUserCanParticipate,
  type VisibilityLineup,
  type EligibilityCaller,
} from './lineups-eligibility.helpers';

function makeLineup(
  overrides: Partial<VisibilityLineup> = {},
): VisibilityLineup {
  return { id: 1, createdBy: 10, visibility: 'public', ...overrides };
}

/**
 * Mock the Drizzle chain used by `isInvitee`:
 * `select().from().innerJoin().where().limit()`. The `innerJoin` on the
 * `users` table + `activeUsersFilter()` predicate is how ROK-1412 excludes
 * deactivated invitees — so `innerJoin` is exposed for assertion.
 */
function makeDb(inviteeUserIds: number[]) {
  const limit = jest
    .fn()
    .mockResolvedValue(inviteeUserIds.length > 0 ? [{ id: 1 }] : []);
  const where = jest.fn().mockReturnValue({ limit });
  const innerJoin = jest.fn().mockReturnValue({ where });
  const from = jest.fn().mockReturnValue({ innerJoin });
  const select = jest.fn().mockReturnValue({ from });
  const db = { select } as unknown as Parameters<
    typeof assertUserCanParticipate
  >[0];
  return { db, innerJoin, where };
}

describe('assertUserCanParticipate', () => {
  it('allows anyone on a public lineup', async () => {
    const { db } = makeDb([]);
    const lineup = makeLineup({ visibility: 'public' });
    const caller: EligibilityCaller = { id: 999, role: 'member' };
    await expect(
      assertUserCanParticipate(db, lineup, caller),
    ).resolves.toBeUndefined();
  });

  it('allows the creator on a private lineup', async () => {
    const { db } = makeDb([]);
    const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
    await expect(
      assertUserCanParticipate(db, lineup, { id: 10, role: 'member' }),
    ).resolves.toBeUndefined();
  });

  it('allows admin and operator roles on a private lineup', async () => {
    const { db } = makeDb([]);
    const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
    await expect(
      assertUserCanParticipate(db, lineup, { id: 5, role: 'admin' }),
    ).resolves.toBeUndefined();
    await expect(
      assertUserCanParticipate(db, lineup, { id: 5, role: 'operator' }),
    ).resolves.toBeUndefined();
  });

  it('allows listed invitees', async () => {
    const { db } = makeDb([42]);
    const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
    await expect(
      assertUserCanParticipate(db, lineup, { id: 42, role: 'member' }),
    ).resolves.toBeUndefined();
  });

  it('rejects non-invitees on a private lineup', async () => {
    const { db } = makeDb([]);
    const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
    await expect(
      assertUserCanParticipate(db, lineup, { id: 77, role: 'member' }),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── ROK-1412: deactivated invitees are excluded via a users join ──
  it('joins the users table so deactivated invitees drop out (ROK-1412)', async () => {
    const { db, innerJoin } = makeDb([42]);
    const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
    await assertUserCanParticipate(db, lineup, { id: 42, role: 'member' });
    // The active-user filter is enforced by innerJoin-ing users; without the
    // join a deactivated invitee's row would still satisfy the check.
    expect(innerJoin).toHaveBeenCalledTimes(1);
    expect(innerJoin).toHaveBeenCalledWith(schema.users, expect.anything());
  });
});
