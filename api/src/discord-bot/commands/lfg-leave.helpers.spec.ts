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
  DISCORD_CONTENT_CAP,
  buildLeftAllReply,
  buildLeftSomeReply,
  matchOwnGroup,
} from './lfg-leave.helpers';
import {
  LFG_LEAVE_ERROR_REPLY,
  buildLeftReply,
  buildNotInGroupReply,
  withdrawIfPresent,
} from '../listeners/lfg-leave.helpers';

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
      { name: 'Helldivers 2', value: '3' },
    ]);
  });

  it('never offers a game the caller is not in — nor All my LFGs alone', () => {
    // Typing a game you are not in must not leave a no-confirm "leave
    // everything" as the only thing to pick.
    expect(buildLeaveChoices(groups, 'deep')).toEqual([]);
  });

  it('offers All my LFGs while the typed text names it', () => {
    expect(buildLeaveChoices(groups, 'ALL')[0]).toEqual(LFG_LEAVE_ALL_CHOICE);
    expect(buildLeaveChoices(groups, 'my lf')).toEqual([LFG_LEAVE_ALL_CHOICE]);
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

describe('matchOwnGroup (ROK-1660)', () => {
  const groups = [lfgGroup(1, 'Valheim', true, 4), lfgGroup(2, 'DRG', false)];

  it('matches an own pick by id or by exact title', () => {
    expect(matchOwnGroup(groups, '1')?.gameId).toBe(1);
    expect(matchOwnGroup(groups, 'valheim')?.gameId).toBe(1);
  });

  it('refuses a game the caller has no hand for, and free text', () => {
    expect(matchOwnGroup(groups, '2')).toBeNull();
    expect(matchOwnGroup(groups, 'Valh')).toBeNull();
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

  it('All my LFGs with 40 long names still fits one Discord message', () => {
    const names = Array.from(
      { length: 40 },
      (_, i) => `${String(i).padStart(2, '0')}${'n'.repeat(48)}`,
    );
    const reply = buildLeftAllReply(names);
    expect(reply.length).toBeLessThanOrEqual(DISCORD_CONTENT_CAP);
    expect(reply).toMatch(/^You're out of all 40 — \*\*00n+\*\*, /);
    expect(reply).toMatch(/ …and \d+ more\.$/);
    const shown = (reply.match(/\*\*\d\dn+\*\*/g) ?? []).length;
    const hidden = Number(/…and (\d+) more/.exec(reply)?.[1]);
    expect(shown + hidden).toBe(40);
  });

  it('a partial All my LFGs names what was left, what was not, then the error', () => {
    expect(buildLeftSomeReply(['A', 'B'], ['Z'])).toBe(
      `You're out of **A**, **B**, but couldn't leave **Z**. ${LFG_LEAVE_ERROR_REPLY}`,
    );
  });

  it('a partial reply with nothing left is just the error line', () => {
    expect(buildLeftSomeReply([], ['Z'])).toBe(LFG_LEAVE_ERROR_REPLY);
  });

  it('a partial reply with 40 long names on each side still fits', () => {
    const names = Array.from({ length: 40 }, (_, i) => `${i}${'x'.repeat(49)}`);
    const reply = buildLeftSomeReply(names, names);
    expect(reply.length).toBeLessThanOrEqual(DISCORD_CONTENT_CAP);
    expect(reply.endsWith(LFG_LEAVE_ERROR_REPLY)).toBe(true);
  });
});

describe('withdrawIfPresent — the shared write wrapper (ROK-1660)', () => {
  it('returns true after the one write path succeeds', async () => {
    const withdraw = jest.fn().mockResolvedValue(undefined);
    await expect(withdrawIfPresent({ withdraw }, 7, 1)).resolves.toBe(true);
    expect(withdraw).toHaveBeenCalledWith(7, 1);
  });

  it('maps NotFound (no hand) to false', async () => {
    const withdraw = jest.fn().mockRejectedValue(new NotFoundException());
    await expect(withdrawIfPresent({ withdraw }, 7, 1)).resolves.toBe(false);
  });

  it('lets every other failure propagate', async () => {
    const withdraw = jest.fn().mockRejectedValue(new Error('db down'));
    await expect(withdrawIfPresent({ withdraw }, 7, 1)).rejects.toThrow(
      'db down',
    );
  });
});
