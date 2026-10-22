import { PgDialect } from 'drizzle-orm/pg-core';
import { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import {
  HUB_LINK_KINDS,
  resolveGameHubLink,
  resolveGameHubLinkSafe,
  resolveGameHubLinks,
  setActiveHubKindsSource,
} from './hub-link.resolver';

const BASE = 'https://raid.example.com';

function asDb(mock: MockDb): PostgresJsDatabase<typeof schema> {
  return mock as unknown as PostgresJsDatabase<typeof schema>;
}

/** Render the WHERE clause the resolver handed drizzle. */
function whereSql(mock: MockDb): string {
  const arg: unknown = mock.where.mock.calls[0]?.[0];
  if (!(arg instanceof SQL)) throw new Error('where() got no SQL');
  return new PgDialect().sqlToQuery(arg).sql;
}

describe('resolveGameHubLink (D15)', () => {
  let mock: MockDb;
  beforeEach(() => {
    mock = createDrizzleMock();
  });

  it('H1: a visible tagged hub wins over the game hubs', async () => {
    mock.where.mockResolvedValueOnce([{ id: 3 }, { id: 9 }, { id: 4 }]);
    const link = await resolveGameHubLink(asDb(mock), {
      gameId: 1,
      taggedGuildId: 9,
      clientUrl: BASE,
    });
    expect(link).toEqual({ url: `${BASE}/guilds/9`, label: 'Hub' });
    expect(whereSql(mock)).toContain('"guilds"."id" = $');
  });

  it('ROK-1895: a visible tagged hub carries its name; the game hub never does', async () => {
    mock.where.mockResolvedValueOnce([
      { id: 3, name: 'Game Hub' },
      { id: 9, name: 'Tagged Hub' },
    ]);
    const tagged = await resolveGameHubLink(asDb(mock), {
      gameId: 1,
      taggedGuildId: 9,
      clientUrl: BASE,
    });
    expect(tagged).toStrictEqual({
      url: `${BASE}/guilds/9`,
      label: 'Hub',
      hubName: 'Tagged Hub',
    });
    mock.where.mockResolvedValueOnce([{ id: 3, name: 'Game Hub' }]);
    const derived = await resolveGameHubLink(asDb(mock), {
      gameId: 1,
      clientUrl: BASE,
    });
    expect(derived).toStrictEqual({ url: `${BASE}/guilds/3`, label: 'Hub' });
  });

  it('ROK-1895: a hidden tagged hub (filtered in SQL) falls back unnamed', async () => {
    mock.where.mockResolvedValueOnce([{ id: 5, name: 'Game Hub' }]);
    const link = await resolveGameHubLink(asDb(mock), {
      gameId: 1,
      taggedGuildId: 9,
      clientUrl: BASE,
    });
    expect(link).toStrictEqual({ url: `${BASE}/guilds/5`, label: 'Hub' });
  });

  it("H2: untagged, the game's single visible hub resolves to it", async () => {
    mock.where.mockResolvedValueOnce([{ id: 5 }]);
    const link = await resolveGameHubLink(asDb(mock), {
      gameId: 1,
      clientUrl: `${BASE}/`,
    });
    expect(link).toEqual({ url: `${BASE}/guilds/5`, label: 'Hub' });
  });

  it('H3: hidden hubs are filtered in SQL; a hidden tag falls back', async () => {
    mock.where.mockResolvedValueOnce([{ id: 5 }]);
    const link = await resolveGameHubLink(asDb(mock), {
      gameId: 1,
      taggedGuildId: 9,
      clientUrl: BASE,
    });
    expect(link).toEqual({ url: `${BASE}/guilds/5`, label: 'Hub' });
    const sql = whereSql(mock);
    expect(sql).toContain('"guilds"."hidden_at" is null');
    expect(sql).toContain('"guilds"."kind" in');
  });

  it('H3b (Codex r14 P2): an archived tagged hub falls back — SQL requires status active', async () => {
    // The DB drops the archived tag (status filter); the game's active hub is left.
    mock.where.mockResolvedValueOnce([{ id: 5 }]);
    const link = await resolveGameHubLink(asDb(mock), {
      gameId: 1,
      taggedGuildId: 9,
      clientUrl: BASE,
    });
    expect(link).toEqual({ url: `${BASE}/guilds/5`, label: 'Hub' });
    expect(whereSql(mock)).toContain('"guilds"."status" = $');
  });

  it('H3c (Codex r14 P2): an archived tagged hub with no fallback resolves to none', async () => {
    mock.where.mockResolvedValueOnce([]);
    const link = await resolveGameHubLink(asDb(mock), {
      gameId: 1,
      taggedGuildId: 9,
      clientUrl: BASE,
    });
    expect(link).toBeNull();
    expect(whereSql(mock)).toContain('"guilds"."status" = $');
  });

  // TODO(ROK-1873): L11 flips this to the `/hubs?game=` directory once it exists.
  it('H4: two or more hubs link the oldest (lowest id) hub — never a 404 directory', async () => {
    mock.where.mockResolvedValueOnce([{ id: 6 }, { id: 5 }]);
    const link = await resolveGameHubLink(asDb(mock), {
      gameId: 12,
      clientUrl: BASE,
    });
    expect(link).toEqual({ url: `${BASE}/guilds/5`, label: 'Hub' });
  });

  it('H5: no hub, no game or no CLIENT_URL resolves to null', async () => {
    mock.where.mockResolvedValueOnce([]);
    const db = asDb(mock);
    await expect(
      resolveGameHubLink(db, { gameId: 1, clientUrl: BASE }),
    ).resolves.toBeNull();
    await expect(
      resolveGameHubLink(db, { gameId: 1, clientUrl: null }),
    ).resolves.toBeNull();
    await expect(
      resolveGameHubLink(db, { gameId: null, clientUrl: BASE }),
    ).resolves.toBeNull();
    expect(mock.where).toHaveBeenCalledTimes(1);
  });
});

describe('HUB_LINK_KINDS', () => {
  it('links only game_server hubs until L11 adds game_community', () => {
    expect(HUB_LINK_KINDS).toEqual(['game_server']);
  });
});

describe('resolveGameHubLinkSafe', () => {
  it('logs and returns null when resolution throws', async () => {
    const mock = createDrizzleMock();
    mock.where.mockRejectedValueOnce(new Error('db down'));
    const logger = { warn: jest.fn() };
    const link = await resolveGameHubLinkSafe(
      asDb(mock),
      { gameId: 1, clientUrl: BASE },
      logger,
    );
    expect(link).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('db down'),
    );
  });
});

describe('resolveGameHubLinks (batch)', () => {
  it('groups hubs per game; ≥ 2 hubs → the oldest (TODO(ROK-1873))', async () => {
    const mock = createDrizzleMock();
    mock.where.mockResolvedValueOnce([
      { id: 5, gameId: 1 },
      { id: 7, gameId: 2 },
      { id: 6, gameId: 2 },
    ]);
    const links = await resolveGameHubLinks(asDb(mock), [1, 2, 3, 1], BASE);
    expect(links.get(1)).toEqual({ url: `${BASE}/guilds/5`, label: 'Hub' });
    expect(links.get(2)).toEqual({ url: `${BASE}/guilds/6`, label: 'Hub' });
    expect(links.has(3)).toBe(false);
  });

  it('skips the query with no games or no CLIENT_URL', async () => {
    const mock = createDrizzleMock();
    expect((await resolveGameHubLinks(asDb(mock), [], BASE)).size).toBe(0);
    expect((await resolveGameHubLinks(asDb(mock), [1], null)).size).toBe(0);
    expect(mock.select).not.toHaveBeenCalled();
  });
});

describe('disabled hub kinds (Codex r17 P2)', () => {
  let mock: MockDb;
  beforeEach(() => {
    mock = createDrizzleMock();
  });
  afterEach(() => setActiveHubKindsSource(null));

  /** Render the first WHERE clause with its bound params. */
  function firstWhere(): { sql: string; params: unknown[] } {
    const arg: unknown = mock.where.mock.calls[0]?.[0];
    if (!(arg instanceof SQL)) throw new Error('where() got no SQL');
    return new PgDialect().sqlToQuery(arg);
  }

  it('a disabled kind is never a candidate — tagged or game hub', async () => {
    setActiveHubKindsSource(() => ['wow_guild', 'game_community']);
    mock.where.mockResolvedValueOnce([]);
    const link = await resolveGameHubLink(asDb(mock), {
      gameId: 1,
      taggedGuildId: 9,
      clientUrl: BASE,
    });
    expect(link).toBeNull();
    const q = firstWhere();
    expect(q.params).not.toContain('game_server');
    expect(q.params).toEqual(
      expect.arrayContaining(['wow_guild', 'game_community']),
    );
  });

  it('a tagged hub of a disabled kind falls back to an active-kind game hub', async () => {
    setActiveHubKindsSource(() => ['game_server']);
    mock.where.mockResolvedValueOnce([{ id: 5 }]);
    const link = await resolveGameHubLink(asDb(mock), {
      gameId: 1,
      taggedGuildId: 9,
      clientUrl: BASE,
    });
    expect(link).toEqual({ url: `${BASE}/guilds/5`, label: 'Hub' });
    const q = firstWhere();
    expect(q.params).toContain('game_server');
    expect(q.params).not.toContain('wow_guild');
    // The live-kind filter wraps the whole scope, tagged branch included.
    expect(q.sql).toMatch(/"guilds"\."kind" in \(\$\d+\) and \(/);
  });

  it('batch: no live link kind → no query, no links', async () => {
    setActiveHubKindsSource(() => ['wow_guild']);
    const links = await resolveGameHubLinks(asDb(mock), [1, 2], BASE);
    expect(links.size).toBe(0);
    expect(mock.where).not.toHaveBeenCalled();
  });
});
