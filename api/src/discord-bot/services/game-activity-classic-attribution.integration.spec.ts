/**
 * ROK-2259 — live path: a Classic-family session that the name registry
 * resolves to TBC Anniversary (presence via a discord_game_mappings row, voice
 * via the resolved games.name) is credited per player once the WoW plugin is
 * active: Forever character -> Forever, Anniversary-only -> Anniversary, no WoW
 * characters -> Forever. The raw name "World of Warcraft Classic" follows the
 * same rule even with no mapping row (resolved to no game); any other unmapped
 * name stays uncredited. Real DB + the real Nest wiring of
 * GameActivityService and the plugin-owned ClassicActivityAttributionService.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { ClassicActivityAttributionService } from '../../plugins/wow-common/classic-activity-attribution.service';
import { GameActivityService } from './game-activity.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const ANNIV_SLUG =
  'world-of-warcraft-burning-crusade-classic-anniversary-edition';

/** Discord's raw Classic name — deliberately NOT inserted as a mapping. */
const CLASSIC_NAME = 'World of Warcraft Classic';

let testApp: TestApp;
let service: GameActivityService;

async function insertGame(slug: string, name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name, slug })
      .returning({ id: schema.games.id }),
    slug,
  );
  return g.id;
}

async function insertUser(
  tag: string,
  char?: { gameId: number; gameVariant: string | null },
): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `d:2259-live-${tag}`, username: `live-${tag}` })
      .returning({ id: schema.users.id }),
    tag,
  );
  if (char) {
    await testApp.db
      .insert(schema.characters)
      .values({ userId: u.id, name: `Live${tag}`, ...char });
  }
  return u.id;
}

async function gameOfSession(userId: number): Promise<number | null> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ gameId: schema.gameActivitySessions.gameId })
      .from(schema.gameActivitySessions)
      .where(eq(schema.gameActivitySessions.userId, userId)),
    `session of ${userId}`,
  );
  return row.gameId;
}

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(GameActivityService);
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  // After the truncate: the WoW plugin owns the attribution adapter.
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  // The adapter caches the WoW game ids for the process, but each test inserts
  // fresh rows (DELETE-based truncate keeps ids climbing): drop the cache.
  Object.assign(testApp.app.get(ClassicActivityAttributionService), {
    ids: null,
  });
});

// No afterAll truncate: the shared integration setup closes the pool.

describe('ROK-2259 live attribution of Anniversary-resolved play', () => {
  it('credits each player per their characters on the presence and voice paths', async () => {
    // Unique names: the service's name cache outlives a truncate.
    const run = Date.now();
    const forever = await insertGame(FOREVER_SLUG, `Forever ${run}`);
    const annivName = `Anniversary ${run}`;
    const anniv = await insertGame(ANNIV_SLUG, annivName);
    const presenceName = `WoW Classic ${run}`;
    await testApp.db
      .insert(schema.discordGameMappings)
      .values({ discordActivityName: presenceName, gameId: anniv });

    const fc = await insertUser(`fc-${run}`, {
      gameId: anniv,
      gameVariant: 'wow_forever',
    });
    const ao = await insertUser(`ao-${run}`, {
      gameId: anniv,
      gameVariant: null,
    });
    const nc = await insertUser(`nc-${run}`);

    const at = new Date();
    service.bufferStart(fc, presenceName, at, 'presence');
    service.bufferStart(ao, presenceName, at, 'presence');
    service.bufferStart(nc, annivName, at, 'voice');
    await service.flush();

    expect({
      foreverChar: await gameOfSession(fc),
      anniversaryOnly: await gameOfSession(ao),
      noChars: await gameOfSession(nc),
    }).toEqual({
      foreverChar: forever,
      anniversaryOnly: anniv,
      noChars: forever,
    });

    service.bufferStop(fc, presenceName, at, 'presence');
    service.bufferStop(ao, presenceName, at, 'presence');
    service.bufferStop(nc, annivName, at, 'voice');
    await service.flush();
  });
});

describe('ROK-2259 live attribution of the unmapped raw Classic name', () => {
  it('credits raw "World of Warcraft Classic" per player when no mapping row exists', async () => {
    const run = Date.now();
    const forever = await insertGame(FOREVER_SLUG, `Forever raw ${run}`);
    const anniv = await insertGame(ANNIV_SLUG, `Anniversary raw ${run}`);

    const fc = await insertUser(`rfc-${run}`, {
      gameId: anniv,
      gameVariant: 'wow_forever',
    });
    const ao = await insertUser(`rao-${run}`, {
      gameId: anniv,
      gameVariant: null,
    });
    const nc = await insertUser(`rnc-${run}`);
    const other = await insertUser(`rot-${run}`);
    const otherName = `Unmapped Game ${run}`;

    const at = new Date();
    const pairs: [number, string][] = [
      [fc, CLASSIC_NAME],
      [ao, CLASSIC_NAME],
      [nc, CLASSIC_NAME],
      [other, otherName],
    ];
    for (const [u, n] of pairs) service.bufferStart(u, n, at, 'presence');
    await service.flush();

    expect({
      foreverChar: await gameOfSession(fc),
      anniversaryOnly: await gameOfSession(ao),
      noChars: await gameOfSession(nc),
      unrelated: await gameOfSession(other),
    }).toEqual({
      foreverChar: forever,
      anniversaryOnly: anniv,
      noChars: forever,
      unrelated: null,
    });

    for (const [u, n] of pairs) service.bufferStop(u, n, at, 'presence');
    await service.flush();
  });
});
