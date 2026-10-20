/**
 * ROK-1870 M4/M6–M8/M14 — CommunityLeaderGuard admits the hub's Leader as
 * the hub kind's ladder resolves it (a `hub_community_members` row with
 * role `leader`, or staff ⇒ leader), not only staff.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { LadderRole } from '@raid-ledger/contract';
import type { GuildActor } from '../guild-access.service';
import { CommunityLeaderGuard } from './community-leader.guard';

const member: GuildActor = { id: 5, role: 'member' };
const admin: GuildActor = { id: 1, role: 'admin' };

function guardWith(role: LadderRole) {
  const access = {
    resolveLadder: jest.fn((actor: GuildActor): Promise<LadderRole> =>
      Promise.resolve(actor.role === 'member' ? role : 'leader'),
    ),
  };
  return { guard: new CommunityLeaderGuard(access), access };
}

describe('CommunityLeaderGuard', () => {
  it('admits a community-hub leader (ladder role leader) on the route id', async () => {
    const { guard, access } = guardWith('leader');
    await expect(
      guard.check({ user: member, params: { id: '12' } }),
    ).resolves.toBe(true);
    expect(access.resolveLadder).toHaveBeenCalledWith(member, 12);
  });

  it('admits staff (the ladder resolves staff to leader)', async () => {
    const { guard } = guardWith('visitor');
    await expect(
      guard.check({ user: admin, params: { id: '3' } }),
    ).resolves.toBe(true);
  });

  it.each<LadderRole>(['officer', 'member', 'visitor'])(
    'refuses a %s with 403',
    async (role) => {
      const { guard } = guardWith(role);
      await expect(
        guard.check({ user: member, params: { id: '12' } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('returns false with no authenticated user', async () => {
    const { guard, access } = guardWith('leader');
    await expect(guard.check({ params: { id: '1' } })).resolves.toBe(false);
    expect(access.resolveLadder).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric id with 400', async () => {
    const { guard } = guardWith('leader');
    await expect(
      guard.check({ user: member, params: { id: 'abc' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
