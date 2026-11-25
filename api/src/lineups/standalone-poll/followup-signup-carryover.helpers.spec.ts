/**
 * ROK-2320 — unit proof of the follow-up carryover helpers: the role
 * fallback order, the degrade-to-empty read, and the creator's retry.
 * The DB-backed path lives in
 * `standalone-poll-followup-carryover.integration.spec.ts`.
 */
import type { Logger } from '@nestjs/common';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { findFollowupSourceEventId } from '../scheduling/scheduling-query.helpers';
import {
  buildCarryDto,
  loadFollowupCarryover,
  signUpCreatorWithCarryover,
  type CarryoverDeps,
  type SourceSignupRow,
} from './followup-signup-carryover.helpers';

jest.mock('../scheduling/scheduling-query.helpers', () => ({
  findFollowupSourceEventId: jest.fn(),
}));

const sourceMock = jest.mocked(findFollowupSourceEventId);
const MATCH_ID = 77;
const EVENT_ID = 42;
const USER_ID = 9;
const CHAR_ID = 'char-uuid';

function row(over: Partial<SourceSignupRow>): SourceSignupRow {
  return {
    userId: USER_ID,
    characterId: null,
    preferredRoles: null,
    rosterRole: null,
    characterRole: null,
    characterRoleOverride: null,
    ...over,
  };
}

function makeDeps() {
  const db = createDrizzleMock();
  const warn = jest.fn();
  const deps = {
    db,
    logger: { warn } as unknown as Logger,
  } as unknown as CarryoverDeps;
  return { db, warn, deps };
}

describe('buildCarryDto role fallback (ROK-2320)', () => {
  it.each<[string, Partial<SourceSignupRow>, string[] | undefined]>([
    [
      'preferred roles win, deduped, non-roles dropped',
      {
        preferredRoles: ['tank', 'flex', 'tank', 'dps'],
        rosterRole: 'healer',
      },
      ['tank', 'dps'],
    ],
    [
      'never more than 3 roles',
      { preferredRoles: ['dps', 'healer', 'tank', 'dps', 'healer'] },
      ['dps', 'healer', 'tank'],
    ],
    [
      'empty preferred → roster role',
      { preferredRoles: [], rosterRole: 'healer', characterRole: 'tank' },
      ['healer'],
    ],
    [
      'flex roster role falls through to role_override',
      {
        rosterRole: 'flex',
        characterRoleOverride: 'dps',
        characterRole: 'tank',
      },
      ['dps'],
    ],
    [
      'bench roster role falls through to the character role',
      { rosterRole: 'bench', characterRole: 'tank' },
      ['tank'],
    ],
    ['no role anywhere → no roles', { characterId: CHAR_ID }, undefined],
  ])('%s', (_label, over, roles) => {
    expect(buildCarryDto(row(over))?.preferredRoles).toEqual(roles);
  });

  it('returns null with neither a character nor a role', () => {
    expect(buildCarryDto(row({ rosterRole: 'flex' }))).toBeNull();
  });

  it('carries the character alone when there is no role', () => {
    expect(buildCarryDto(row({ characterId: CHAR_ID }))).toEqual({
      characterId: CHAR_ID,
    });
  });
});

describe('loadFollowupCarryover (ROK-2320)', () => {
  it('a throwing db query yields an empty map and a warning with the match', async () => {
    const { db, warn, deps } = makeDeps();
    sourceMock.mockResolvedValue(5);
    db.select.mockImplementation(() => {
      throw new Error('db blip');
    });

    const result = await loadFollowupCarryover(
      deps,
      { matchId: MATCH_ID, eventId: EVENT_ID },
      [USER_ID],
    );

    expect(result.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${MATCH_ID}`));
  });
});

describe('signUpCreatorWithCarryover (ROK-2320)', () => {
  it('retries a throwing carried signup once with no dto', async () => {
    const { db, warn, deps } = makeDeps();
    sourceMock.mockResolvedValue(5);
    db.limit.mockResolvedValueOnce([{ gameId: 1 }]);
    db.where
      .mockReturnValueOnce(db)
      .mockResolvedValueOnce([
        row({ characterId: CHAR_ID, preferredRoles: ['tank'] }),
      ]);
    const signup = jest
      .fn()
      .mockRejectedValueOnce(new Error('stale character'))
      .mockResolvedValueOnce({ assignedSlot: 'tank' });
    const opts = { skipEndedCheck: true };

    await signUpCreatorWithCarryover(
      { ...deps, signupsService: { signup } },
      MATCH_ID,
      [EVENT_ID],
      USER_ID,
    );

    expect(signup.mock.calls).toEqual([
      [
        EVENT_ID,
        USER_ID,
        { characterId: CHAR_ID, preferredRoles: ['tank'] },
        opts,
      ],
      [EVENT_ID, USER_ID, undefined, opts],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
