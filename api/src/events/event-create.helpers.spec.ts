/**
 * ROK-1893 P3 (D16): `inheritPollHub` — the hub a poll-locked event inherits.
 * ROK-2212: membership is the hub kind's (`isMember`), so a plain member of a
 * `wow_guild` hub (live linked roster row, no `hub_community_members` row)
 * inherits exactly as a community-hub member does.
 */
import type { CreateEventDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { inheritPollHub } from './event-create.helpers';
import {
  findMatchPollHub,
  type PollHub,
} from '../lineups/standalone-poll/standalone-poll-hub.helpers';

jest.mock('../lineups/standalone-poll/standalone-poll-hub.helpers', () => ({
  ...jest.requireActual<object>(
    '../lineups/standalone-poll/standalone-poll-hub.helpers',
  ),
  findMatchPollHub: jest.fn(),
}));

const guildHub: PollHub = {
  id: 7,
  name: 'Guild',
  gameId: 3,
  memberCount: 2,
  kind: 'wow_guild',
};
const communityHub: PollHub = { ...guildHub, kind: 'game_community' };
const dto: CreateEventDto = {
  title: 'From poll',
  gameId: 3,
  startTime: '2026-11-01T18:00:00.000Z',
  endTime: '2026-11-01T20:00:00.000Z',
  schedulingMatchId: 11,
};

let mockDb: MockDb;
const db = (): PostgresJsDatabase<typeof schema> =>
  mockDb as unknown as PostgresJsDatabase<typeof schema>;
const member = jest.fn((userId: number) => Promise.resolve(userId === 5));

describe('inheritPollHub', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = createDrizzleMock();
    mockDb.limit.mockResolvedValue([{ role: 'member' }]);
    jest.mocked(findMatchPollHub).mockResolvedValue(guildHub);
  });

  it('a guild-hub member (by the kind-aware check) inherits the guild hub', async () => {
    const out = await inheritPollHub(db(), dto, 5, member);
    expect(out.guildId).toBe(7);
    expect(member).toHaveBeenCalledWith(5, 7);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('a non-member, non-staff creator does not inherit the guild hub', async () => {
    const out = await inheritPollHub(db(), dto, 6, member);
    expect(out.guildId).toBeUndefined();
    expect(member).toHaveBeenCalledWith(6, 7);
  });

  it('staff off the roster still inherit the guild hub', async () => {
    mockDb.limit.mockResolvedValue([{ role: 'operator' }]);
    const out = await inheritPollHub(db(), dto, 6, member);
    expect(out.guildId).toBe(7);
  });

  it('a community hub uses the same check — member inherits, outsider does not', async () => {
    jest.mocked(findMatchPollHub).mockResolvedValue(communityHub);
    expect((await inheritPollHub(db(), dto, 5, member)).guildId).toBe(7);
    expect(
      (await inheritPollHub(db(), dto, 6, member)).guildId,
    ).toBeUndefined();
  });

  it("does not inherit a hub of another game, and never asks who's a member", async () => {
    jest.mocked(findMatchPollHub).mockResolvedValue({ ...guildHub, gameId: 4 });
    expect(
      (await inheritPollHub(db(), dto, 5, member)).guildId,
    ).toBeUndefined();
    expect(member).not.toHaveBeenCalled();
  });

  it('keeps an explicit guildId: null (opt-out) and an explicit other guild', async () => {
    const optOut = await inheritPollHub(
      db(),
      { ...dto, guildId: null },
      5,
      member,
    );
    expect(optOut.guildId).toBeNull();
    const other = await inheritPollHub(db(), { ...dto, guildId: 9 }, 5, member);
    expect(other.guildId).toBe(9);
    expect(findMatchPollHub).not.toHaveBeenCalled();
  });
});
