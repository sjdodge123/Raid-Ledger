/**
 * ROK-2259 — live path: a Classic-family session that the name registry
 * resolves to TBC Anniversary (presence via a discord_game_mappings row, voice
 * via the resolved games.name) is credited per player once the WoW plugin is
 * active: Forever character -> Forever, Anniversary-only -> Anniversary, no WoW
 * characters -> Forever. Real DB + the real Nest wiring of
 * GameActivityService and the plugin-owned ClassicActivityAttributionService.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { GameActivityService } from './game-activity.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const ANNIV_SLUG =
  'world-of-warcraft-burning-crusade-classic-anniversary-edition';

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
