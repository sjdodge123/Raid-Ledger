/**
 * ROK-1660 — `/lfg-leave` pure pieces: own-hands-only autocomplete and the
 * exact reply copy (one row per line of the spec's copy sheet).
 */
import { NotFoundException } from '@nestjs/common';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import {
  LFG_LEAVE_ALL_CHOICE,
  LFG_LEAVE_NONE_CHOICE,
  buildLeaveChoices,
  buildLeftAllReply,
  buildLeftReply,
  buildNotInGroupReply,
  matchOwnGroup,
  remainingCount,
  tryWithdraw,
} from './lfg-leave.helpers';

function lfgGroup(
  gameId: number,
  gameName: string,
  hasOwnIntent: boolean,
  activeCount = 2,
): LfgGroupSummaryDto {
  return {
    gameId,
    gameName,
    gameSlug: gameName.toLowerCase().replace(/\s+/g, '-'),
    gameCoverUrl: null,
    activeCount,
    nowCount: 0,
    state: 'lfg',
    viabilityThreshold: null,
    isViable: false,
    hasOwnIntent,
    soonestExpiresAt: null,
    soonestNowExpiresAt: null,
    playingNow: null,
  };
}

describe('buildLeaveChoices (ROK-1660)', () => {
  const groups = [
    lfgGroup(1, 'Valheim', true),
    lfgGroup(2, 'Deep Rock Galactic', false),
    lfgGroup(3, 'Helldivers 2', true),
  ];

  it('puts All my LFGs first, then ONLY games the caller has a hand for', () => {
    expect(buildLeaveChoices(groups, '')).toEqual([
      { name: 'All my LFGs', value: 'all' },
      { name: 'Valheim', value: '1' },
      { name: 'Helldivers 2', value: '3' },
    ]);
  });

  it('filters own games by the typed text, case-insensitively', () => {
    expect(buildLeaveChoices(groups, 'HELL')).toEqual([
      LFG_LEAVE_ALL_CHOICE,
      { name: 'Helldivers 2', value: '3' },
    ]);
  });

  it('never offers a game the caller is not in, even when typed', () => {
    const values = buildLeaveChoices(groups, 'deep').map((c) => c.value);
    expect(values).toEqual(['all']);
  });

  it('answers the single none choice when the caller has no hands', () => {
    expect(buildLeaveChoices([lfgGroup(2, 'DRG', false)], '')).toEqual([
      { name: "You're not in any LFG", value: 'none' },
    ]);
    expect(buildLeaveChoices([], 'x')).toEqual([LFG_LEAVE_NONE_CHOICE]);
  });

  it('stays within Discord’s 25-choice cap and 100-char names', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      lfgGroup(i + 1, `${'G'.repeat(120)}${i}`, true),
    );
    const choices = buildLeaveChoices(many, '');
    expect(choices).toHaveLength(25);
    expect(choices[0]).toEqual(LFG_LEAVE_ALL_CHOICE);
    expect(Math.max(...choices.map((c) => c.name.length))).toBe(100);
  });
});

describe('matchOwnGroup / remainingCount (ROK-1660)', () => {
  const groups = [lfgGroup(1, 'Valheim', true, 4), lfgGroup(2, 'DRG', false)];

  it('matches an own pick by id or by exact title', () => {
    expect(matchOwnGroup(groups, '1')?.gameId).toBe(1);
    expect(matchOwnGroup(groups, 'valheim')?.gameId).toBe(1);
  });

  it('refuses a game the caller has no hand for, and free text', () => {
    expect(matchOwnGroup(groups, '2')).toBeNull();
    expect(matchOwnGroup(groups, 'Valh')).toBeNull();
  });

  it('reads the remaining count, 0 once the group is gone', () => {
    expect(remainingCount(groups, 1)).toBe(4);
    expect(remainingCount(groups, 99)).toBe(0);
  });
});

describe('/lfg-leave reply copy (ROK-1660)', () => {
  it('one game left, others still looking', () => {
    expect(buildLeftReply('Valheim', 3)).toBe(
      "You're out — **Valheim**. 3 still looking.",
    );
  });

  it('one game left, nobody remains', () => {
    expect(buildLeftReply('Valheim', 0)).toBe("You're out — **Valheim**.");
  });

  it('not in that group', () => {
    expect(buildNotInGroupReply('Valheim')).toBe(
      "You're not in the **Valheim** group.",
    );
  });

  it('All my LFGs with several groups', () => {
    expect(buildLeftAllReply(['A', 'B', 'C'])).toBe(
      "You're out of all 3 — **A**, **B**, **C**.",
    );
  });
});

describe('tryWithdraw (ROK-1660)', () => {
  it('returns true after the one write path succeeds', async () => {
    const withdraw = jest.fn().mockResolvedValue(undefined);
    await expect(tryWithdraw({ withdraw }, 7, 1)).resolves.toBe(true);
    expect(withdraw).toHaveBeenCalledWith(7, 1);
  });

  it('maps NotFound (no hand) to false', async () => {
    const withdraw = jest.fn().mockRejectedValue(new NotFoundException());
    await expect(tryWithdraw({ withdraw }, 7, 1)).resolves.toBe(false);
  });

  it('lets every other failure propagate', async () => {
    const withdraw = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(tryWithdraw({ withdraw }, 7, 1)).rejects.toThrow('db down');
  });
});
