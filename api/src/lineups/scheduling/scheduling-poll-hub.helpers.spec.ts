/**
 * ROK-2212: the poll page's hub member flags follow the hub's kind. A
 * `wow_guild` hub's members are its live linked roster (the kind-aware
 * `isMember`), not `hub_community_members`; a community hub is unchanged.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { loadPollHubView } from './scheduling-poll-hub.helpers';
import {
  findVisiblePollHub,
  type PollHub,
} from '../standalone-poll/standalone-poll-hub.helpers';

jest.mock('../standalone-poll/standalone-poll-hub.helpers', () => ({
  findVisiblePollHub: jest.fn(),
}));

const guildHub: PollHub = {
  id: 4,
  name: 'Guild',
  gameId: 3,
  memberCount: 2,
  kind: 'wow_guild',
};

let mockDb: MockDb;
const db = (): PostgresJsDatabase<typeof schema> =>
  mockDb as unknown as PostgresJsDatabase<typeof schema>;
const rosterOf = (ids: number[]) =>
  jest.fn((userId: number) => Promise.resolve(ids.includes(userId)));

describe('loadPollHubView — member flags by hub kind (ROK-2212)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = createDrizzleMock();
    jest.mocked(findVisiblePollHub).mockResolvedValue(guildHub);
  });

  it('flags the guild-hub members among the voters and the viewer', async () => {
    mockDb.where.mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]);
    const isMember = rosterOf([1, 9]);
    const view = await loadPollHubView(db(), 4, 9, [11, 12], isMember);
    expect([...(view.memberIds ?? [])].sort()).toEqual([1, 9]);
    expect(view.hub?.viewerIsMember).toBe(true);
    expect(isMember).toHaveBeenCalledWith(2, 4);
    expect(mockDb.from).not.toHaveBeenCalledWith(schema.hubCommunityMembers);
  });

  it('a viewer off the guild roster is not a member', async () => {
    const isMember = rosterOf([1]);
    const view = await loadPollHubView(db(), 4, 3, [], isMember);
    expect(view.memberIds?.size).toBe(0);
    expect(view.hub?.viewerIsMember).toBe(false);
    expect(isMember).toHaveBeenCalledWith(3, 4);
    expect(mockDb.selectDistinct).not.toHaveBeenCalled();
  });

  it('a community hub still reads hub_community_members, never isMember', async () => {
    jest
      .mocked(findVisiblePollHub)
      .mockResolvedValue({ ...guildHub, kind: 'game_community' });
    mockDb.where
      .mockReturnValueOnce(mockDb)
      .mockResolvedValueOnce([{ userId: 1 }]);
    const isMember = rosterOf([1, 2, 9]);
    const view = await loadPollHubView(db(), 4, 9, [11], isMember);
    expect([...(view.memberIds ?? [])]).toEqual([1]);
    expect(view.hub?.viewerIsMember).toBe(false);
    expect(mockDb.from).toHaveBeenCalledWith(schema.hubCommunityMembers);
    expect(isMember).not.toHaveBeenCalled();
  });

  it('an untagged poll has no hub and asks no one', async () => {
    const isMember = rosterOf([1]);
    expect(await loadPollHubView(db(), null, 9, [11], isMember)).toEqual({
      hub: null,
      memberIds: null,
    });
    expect(isMember).not.toHaveBeenCalled();
  });
});
