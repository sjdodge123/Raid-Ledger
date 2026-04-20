/**
 * Unit tests for private-lineup eligibility (ROK-1065).
 */
import { ForbiddenException } from '@nestjs/common';
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

function makeDb(inviteeUserIds: number[]) {
  const limit = jest
    .fn()
    .mockResolvedValue(inviteeUserIds.length > 0 ? [{ id: 1 }] : []);
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  return { select } as unknown as Parameters<
    typeof assertUserCanParticipate
  >[0];
}

describe('assertUserCanParticipate', () => {
  it('allows anyone on a public lineup', async () => {
    const db = makeDb([]);
    const lineup = makeLineup({ visibility: 'public' });
    const caller: EligibilityCaller = { id: 999, role: 'member' };
    await expect(
      assertUserCanParticipate(db, lineup, caller),
    ).resolves.toBeUndefined();
  });

  it('allows the creator on a private lineup', async () => {
    const db = makeDb([]);
    const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
    await expect(
      assertUserCanParticipate(db, lineup, { id: 10, role: 'member' }),
    ).resolves.toBeUndefined();
  });

  it('allows admin and operator roles on a private lineup', async () => {
    const db = makeDb([]);
    const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
    await expect(
      assertUserCanParticipate(db, lineup, { id: 5, role: 'admin' }),
    ).resolves.toBeUndefined();
    await expect(
      assertUserCanParticipate(db, lineup, { id: 5, role: 'operator' }),
    ).resolves.toBeUndefined();
  });

  it('allows listed invitees', async () => {
    const db = makeDb([42]);
    const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
    await expect(
      assertUserCanParticipate(db, lineup, { id: 42, role: 'member' }),
    ).resolves.toBeUndefined();
  });

  it('rejects non-invitees on a private lineup', async () => {
    const db = makeDb([]);
    const lineup = makeLineup({ visibility: 'private', createdBy: 10 });
    await expect(
      assertUserCanParticipate(db, lineup, { id: 77, role: 'member' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
