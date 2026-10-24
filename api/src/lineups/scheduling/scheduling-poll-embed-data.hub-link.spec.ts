/**
 * ROK-1872 (ROK-1428 §2.8): the scheduling poll card data carries the poll
 * game's hub link; no hub ⇒ no `hubLink` key. ROK-1896: the lineup's
 * explicit hub tie (`community_lineups.guild_id`) is the resolver's tag.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { resolveGameHubLinkSafe } from '../../discord-bot/channel-lifecycle/hub-link.resolver';
import { loadEmbedData } from './scheduling-poll-embed-data.helpers';

jest.mock('../../discord-bot/channel-lifecycle/hub-link.resolver', () => ({
  resolveGameHubLinkSafe: jest.fn(),
}));
jest.mock('./scheduling-query.helpers', () => ({
  findScheduleSlots: jest.fn(() => Promise.resolve([])),
  findScheduleVotes: jest.fn(() => Promise.resolve([])),
}));

const BASE = 'https://raid.example.com';
const HUB = { url: `${BASE}/hubs/7`, label: 'Hub' as const };
const safe = jest.mocked(resolveGameHubLinkSafe);
const INPUT = { matchId: 3, lineupId: 9, gameId: 5, clientUrl: BASE };

function asDb(mock: MockDb): PostgresJsDatabase<typeof schema> {
  return mock as unknown as PostgresJsDatabase<typeof schema>;
}

describe('loadEmbedData — hub link (ROK-1872)', () => {
  let mock: MockDb;
  beforeEach(() => {
    mock = createDrizzleMock();
    mock.limit.mockResolvedValueOnce([{ name: 'WoW', coverUrl: null }]);
    safe.mockReset();
  });

  it('carries the poll game hub link', async () => {
    mock.limit.mockResolvedValueOnce([{ guildId: null }]);
    safe.mockResolvedValueOnce(HUB);
    const data = await loadEmbedData(asDb(mock), INPUT);
    expect(data?.hubLink).toEqual(HUB);
    expect(safe).toHaveBeenCalledWith(
      expect.anything(),
      { gameId: 5, taggedGuildId: null, clientUrl: BASE },
      expect.anything(),
    );
  });

  it('ROK-1896: passes the lineup hub tie to the resolver', async () => {
    mock.limit.mockResolvedValueOnce([{ guildId: 42 }]);
    const tied = { ...HUB, url: `${BASE}/hubs/42`, hubName: 'Raiders' };
    safe.mockResolvedValueOnce(tied);
    const data = await loadEmbedData(asDb(mock), INPUT);
    expect(safe).toHaveBeenCalledWith(
      expect.anything(),
      { gameId: 5, taggedGuildId: 42, clientUrl: BASE },
      expect.anything(),
    );
    expect(data?.hubLink).toEqual(tied);
  });

  it('ROK-1896: a failed tie lookup falls back to the game hub', async () => {
    mock.limit.mockRejectedValueOnce(new Error('db down'));
    safe.mockResolvedValueOnce(HUB);
    const data = await loadEmbedData(asDb(mock), INPUT);
    expect(safe).toHaveBeenCalledWith(
      expect.anything(),
      { gameId: 5, taggedGuildId: null, clientUrl: BASE },
      expect.anything(),
    );
    expect(data?.hubLink).toEqual(HUB);
  });

  it('omits hubLink when the game has no hub', async () => {
    mock.limit.mockResolvedValueOnce([]);
    safe.mockResolvedValueOnce(null);
    const data = await loadEmbedData(asDb(mock), INPUT);
    expect(data).not.toBeNull();
    expect(data !== null && 'hubLink' in data).toBe(false);
  });
});
