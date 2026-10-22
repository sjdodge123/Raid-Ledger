import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { resolveGameHubLinkSafe } from './hub-link.resolver';
import {
  hubLinkPart,
  resolveEventHubLink,
  resolveLineupDecidedHubLink,
} from './embed-hub-link.helpers';

jest.mock('./hub-link.resolver', () => ({
  resolveGameHubLinkSafe: jest.fn(),
}));

const BASE = 'https://raid.example.com';
const HUB = { url: `${BASE}/guilds/7`, label: 'Hub' as const };
const safe = jest.mocked(resolveGameHubLinkSafe);

function asDb(mock: MockDb): PostgresJsDatabase<typeof schema> {
  return mock as unknown as PostgresJsDatabase<typeof schema>;
}

describe('embed hub link producers helpers (ROK-1872)', () => {
  let mock: MockDb;
  const logger = { warn: jest.fn() };
  beforeEach(() => {
    mock = createDrizzleMock();
    safe.mockReset();
    logger.warn.mockReset();
  });

  it('resolves an event card link from the event game + tagged hub', async () => {
    mock.limit.mockResolvedValueOnce([{ gameId: 5, guildId: 7 }]);
    safe.mockResolvedValueOnce(HUB);
    const link = await resolveEventHubLink(asDb(mock), 42, BASE, logger);
    expect(link).toEqual(HUB);
    expect(safe).toHaveBeenCalledWith(
      expect.anything(),
      { gameId: 5, taggedGuildId: 7, clientUrl: BASE },
      logger,
    );
  });

  it('returns null without a client URL and never queries', async () => {
    expect(await resolveEventHubLink(asDb(mock), 42, null, logger)).toBeNull();
    expect(mock.select).not.toHaveBeenCalled();
  });

  it('returns null when the event row is gone', async () => {
    mock.limit.mockResolvedValueOnce([]);
    expect(await resolveEventHubLink(asDb(mock), 42, BASE, logger)).toBeNull();
    expect(safe).not.toHaveBeenCalled();
  });

  it('never throws when the event lookup fails (logs instead)', async () => {
    mock.limit.mockRejectedValueOnce(new Error('db down'));
    expect(await resolveEventHubLink(asDb(mock), 42, BASE, logger)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('db down'),
    );
  });

  it('resolves the lineup decided game link from decided_game_id', async () => {
    mock.limit.mockResolvedValueOnce([{ decidedGameId: 9 }]);
    safe.mockResolvedValueOnce(HUB);
    const link = await resolveLineupDecidedHubLink(asDb(mock), 3, BASE, logger);
    expect(link).toEqual(HUB);
    expect(safe).toHaveBeenCalledWith(
      expect.anything(),
      { gameId: 9, clientUrl: BASE },
      logger,
    );
  });

  it('lineup without a decided game yields null', async () => {
    mock.limit.mockResolvedValueOnce([{ decidedGameId: null }]);
    expect(
      await resolveLineupDecidedHubLink(asDb(mock), 3, BASE, logger),
    ).toBeNull();
    expect(safe).not.toHaveBeenCalled();
  });

  it('hubLinkPart omits the key without a link (byte-identical context)', () => {
    expect(hubLinkPart(null)).toEqual({});
    expect('hubLink' in hubLinkPart(null)).toBe(false);
    expect(hubLinkPart(HUB)).toEqual({ hubLink: HUB });
  });
});
