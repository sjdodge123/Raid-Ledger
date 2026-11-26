/**
 * ROK-2352 P1-4 — a keyed member the adapter names no role for still lands on
 * the instance's roster: they sign up flex instead of into the MMO event's
 * unassigned pool (which has no roster slot at all).
 */
import type { CreateSignupDto } from '@raid-ledger/contract';
import { withFlexRoles } from './lfg-now-keyed-signup.helpers';
import type { LfgNowHand } from './lfg-now-spawn.types';

function hand(userId: number): LfgNowHand {
  return {
    userId,
    createdAt: new Date('2026-11-26T00:00:00.000Z'),
    discordId: null,
    username: `u${userId}`,
    discordAvatarHash: null,
  };
}

describe('withFlexRoles (ROK-2352 P1-4)', () => {
  it('signs a member with no carryover up on every MMO role', () => {
    const out = withFlexRoles([hand(1)], new Map());
    expect(out.get(1)).toEqual({ preferredRoles: ['tank', 'healer', 'dps'] });
  });

  it('keeps a carried character and adds flex roles when none are carried', () => {
    const carried: CreateSignupDto = { characterId: 'c-1' };
    const out = withFlexRoles([hand(2)], new Map([[2, carried]]));
    expect(out.get(2)).toEqual({
      characterId: 'c-1',
      preferredRoles: ['tank', 'healer', 'dps'],
    });
  });

  it('never overrides roles the adapter carried', () => {
    const carried: CreateSignupDto = { preferredRoles: ['healer'] };
    const out = withFlexRoles([hand(3)], new Map([[3, carried]]));
    expect(out.get(3)).toEqual({ preferredRoles: ['healer'] });
  });
});
