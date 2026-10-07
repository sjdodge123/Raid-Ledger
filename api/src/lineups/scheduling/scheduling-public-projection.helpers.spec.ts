/**
 * ROK-1629 (Q4) — the scheduling poll page strips voter / member Discord ids
 * for anonymous and deactivated viewers; members keep the full payload.
 */
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { projectSchedulePollForViewer } from './scheduling-public-projection.helpers';

const SNOWFLAKE = '123456789012345678';
const voter = {
  userId: 5,
  displayName: 'Thrall',
  avatar: 'hash1',
  discordId: SNOWFLAKE,
  customAvatarUrl: null,
};

function poll(): SchedulePollPageResponseDto {
  return {
    match: { members: [{ ...voter, id: 1, matchId: 2 }] },
    slots: [{ id: 9, votes: [voter], noVotes: [{ ...voter, userId: 6 }] }],
    myVotedSlotIds: [],
  } as unknown as SchedulePollPageResponseDto;
}

/** Every non-null `discordId` value at any depth. */
function leakedIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(leakedIds);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) =>
    k === 'discordId' && v !== null ? [String(v)] : leakedIds(v),
  );
}

describe('projectSchedulePollForViewer (ROK-1629 Q4)', () => {
  it('nulls every voter and member discordId for an anonymous viewer', () => {
    const out = projectSchedulePollForViewer(poll(), false);
    expect(leakedIds(out)).toEqual([]);
    expect(out.slots[0]?.votes[0]?.displayName).toBe('Thrall');
  });

  it('turns the avatar hash into a server-built CDN URL', () => {
    const out = projectSchedulePollForViewer(poll(), false);
    const url = `https://cdn.discordapp.com/avatars/${SNOWFLAKE}/hash1.png`;
    expect(out.slots[0]?.noVotes[0]?.avatar).toBe(url);
    expect(out.match.members[0]?.avatar).toBe(url);
  });

  it('returns the member payload untouched', () => {
    const p = poll();
    expect(projectSchedulePollForViewer(p, true)).toBe(p);
    expect(leakedIds(p)).toHaveLength(3);
  });
});
