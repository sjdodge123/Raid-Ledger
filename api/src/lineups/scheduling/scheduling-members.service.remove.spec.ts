/**
 * Unit gate for `SchedulingMembersService.removeMember` (ROK-2020) and the
 * add path's card re-render (ROK-2020 OPEN-4).
 *
 * The DB boundary is mocked, so these cases pin what the integration spec
 * can only observe indirectly: the Discord card re-render
 * (`fireUpdateEmbed`) fires exactly once AFTER a successful write, and never
 * on a refused one (403 / 400 / 404).
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { createDrizzleMock, type MockDb } from '../../common/testing/drizzle-mock';
import { SchedulingMembersService } from './scheduling-members.service';
import type { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import { findLineupPollMeta } from './scheduling-query.helpers';
import {
  countMatchMembers,
  deleteMatchMemberWithVotes,
} from './scheduling-members-remove.helpers';

jest.mock('./scheduling-poll-embed.service', () => ({
  SchedulingPollEmbedService: class {},
}));
jest.mock('./scheduling-query.helpers', () => ({
  findLineupPollMeta: jest.fn(),
}));
jest.mock('./scheduling-members-remove.helpers', () => ({
  countMatchMembers: jest.fn(),
  deleteMatchMemberWithVotes: jest.fn(),
}));
jest.mock('../lineups-invitees.helpers', () => ({ addInvitees: jest.fn() }));

const mockFindLineupPollMeta = findLineupPollMeta as jest.MockedFunction<
  typeof findLineupPollMeta
>;
const mockDelete = deleteMatchMemberWithVotes as jest.MockedFunction<
  typeof deleteMatchMemberWithVotes
>;
const mockCount = countMatchMembers as jest.MockedFunction<
  typeof countMatchMembers
>;

const LINEUP_ID = 10;
const MATCH_ID = 20;
const CREATOR_ID = 1;
const TARGET_ID = 7;
const CREATOR = { id: CREATOR_ID, role: 'member' };

describe('SchedulingMembersService.removeMember (ROK-2020)', () => {
  let db: MockDb;
  let fireUpdateEmbed: jest.Mock;
  let service: SchedulingMembersService;

  function setLineup(createdBy: number | null = CREATOR_ID): void {
    mockFindLineupPollMeta.mockImplementation((() =>
      Promise.resolve(
        createdBy === null ? [] : [{ id: LINEUP_ID, createdBy }],
      )) as unknown as typeof findLineupPollMeta);
  }

  function setMatch(rows: Record<string, unknown>[]): void {
    db.limit.mockResolvedValue(rows);
  }

  const openMatch = {
    status: 'scheduling',
    visibility: 'public',
    includeSchedulingPhase: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDrizzleMock();
    fireUpdateEmbed = jest.fn();
    service = new SchedulingMembersService(
      db as unknown as PostgresJsDatabase<typeof schema>,
      { fireUpdateEmbed } as unknown as SchedulingPollEmbedService,
    );
    setLineup();
    setMatch([openMatch]);
    mockDelete.mockResolvedValue({ removedVotes: 2, removedMembers: 1 });
    mockCount.mockResolvedValue(3);
  });

  function remove(userId = TARGET_ID, caller = CREATOR) {
    return service.removeMember(LINEUP_ID, MATCH_ID, userId, caller);
  }

  it('deletes, then fires the card re-render exactly once, and returns the counts', async () => {
    await expect(remove()).resolves.toEqual({
      removedVotes: 2,
      memberCount: 3,
    });
    expect(mockDelete).toHaveBeenCalledWith(db, MATCH_ID, TARGET_ID);
    expect(fireUpdateEmbed).toHaveBeenCalledTimes(1);
    expect(fireUpdateEmbed).toHaveBeenCalledWith(MATCH_ID);
    // After the transaction resolved — never before / inside it.
    const deleteOrder = mockDelete.mock.invocationCallOrder[0] ?? Infinity;
    const fireOrder = fireUpdateEmbed.mock.invocationCallOrder[0] ?? -1;
    expect(fireOrder).toBeGreaterThan(deleteOrder);
  });

  it('lets an operator who is not the creator remove a participant', async () => {
    await expect(remove(TARGET_ID, { id: 99, role: 'operator' })).resolves
      .toEqual({ removedVotes: 2, memberCount: 3 });
    expect(fireUpdateEmbed).toHaveBeenCalledTimes(1);
  });

  it('403s an ordinary member and writes nothing', async () => {
    await expect(remove(TARGET_ID, { id: 55, role: 'member' })).rejects
      .toBeInstanceOf(ForbiddenException);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(fireUpdateEmbed).not.toHaveBeenCalled();
  });

  it('400s removing the creator — for the creator themselves and for staff', async () => {
    await expect(remove(CREATOR_ID)).rejects.toThrow(
      "The poll creator can't be removed — cancel the poll instead",
    );
    await expect(
      remove(CREATOR_ID, { id: 99, role: 'admin' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(fireUpdateEmbed).not.toHaveBeenCalled();
  });

  it('400s a poll that is no longer accepting changes', async () => {
    setMatch([{ ...openMatch, status: 'scheduled' }]);
    await expect(remove()).rejects.toBeInstanceOf(BadRequestException);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(fireUpdateEmbed).not.toHaveBeenCalled();
  });

  it('404s a match outside this lineup and an unknown lineup', async () => {
    setMatch([]);
    await expect(remove()).rejects.toThrow('Match not found');
    setLineup(null);
    await expect(remove()).rejects.toThrow('Lineup not found');
    expect(mockDelete).not.toHaveBeenCalled();
    expect(fireUpdateEmbed).not.toHaveBeenCalled();
  });

  it('404s a user who is neither a member nor a voter, without a re-render', async () => {
    mockDelete.mockResolvedValue({ removedVotes: 0, removedMembers: 0 });
    await expect(remove()).rejects.toBeInstanceOf(NotFoundException);
    expect(fireUpdateEmbed).not.toHaveBeenCalled();
  });

  it('addMembers fires the card re-render once, after the insert (OPEN-4)', async () => {
    // loadSchedulableMatch's `.where()` chains into `.limit()`; the user
    // existence check awaits `.where()` directly.
    db.where
      .mockReturnValueOnce(db)
      .mockReturnValueOnce(Promise.resolve([{ id: TARGET_ID }]));
    db.returning.mockResolvedValue([{ id: 500 }]);

    await expect(
      service.addMembers(LINEUP_ID, MATCH_ID, [TARGET_ID], CREATOR),
    ).resolves.toEqual({ added: 1, memberCount: 3 });
    expect(fireUpdateEmbed).toHaveBeenCalledTimes(1);
    expect(fireUpdateEmbed).toHaveBeenCalledWith(MATCH_ID);
    const insertOrder = db.returning.mock.invocationCallOrder[0] ?? Infinity;
    const fireOrder = fireUpdateEmbed.mock.invocationCallOrder[0] ?? -1;
    expect(fireOrder).toBeGreaterThan(insertOrder);
  });

  it('addMembers does not re-render when the caller is refused', async () => {
    await expect(
      service.addMembers(LINEUP_ID, MATCH_ID, [TARGET_ID], {
        id: 55,
        role: 'member',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fireUpdateEmbed).not.toHaveBeenCalled();
  });
});
