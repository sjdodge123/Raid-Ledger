/**
 * ROK-1909 (epic ROK-1905 H2) — `GET guilds/:id` carries `guild.gameSlug` on
 * every hub kind, so web plugin widgets can gate by game (a `wow_guild` hub
 * cannot otherwise tell WoW: Forever from Classic). Read as admin (staff can
 * open every kind); each kind's owning plugin is active.
 */
import { eq } from 'drizzle-orm';
import type { GuildKind } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../plugins/pelican/pelican.constants';

let testApp: TestApp;
let adminToken: string;
let gameSlug: string;

const SOURCE: Record<GuildKind, string> = {
  wow_guild: 'addon_import',
  game_server: 'pelican',
  game_community: 'community',
};

async function insertHub(kind: GuildKind): Promise<number> {
  const name = `Slug Hub ${kind}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind,
        region: kind === 'game_community' ? 'community' : 'us',
        source: SOURCE[kind],
        name,
        nameKey: name.toLowerCase(),
      })
      .returning(),
    `${kind} hub`,
  );
  return g.id;
}

const PLUGINS = ['blizzard', PELICAN_PLUGIN_ID] as const;

function registry(): PluginRegistryService {
  return testApp.app.get(PluginRegistryService);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  const [game] = nonEmpty(
    await testApp.db
      .select({ slug: schema.games.slug })
      .from(schema.games)
      .where(eq(schema.games.id, testApp.seed.game.id)),
    'seed game',
  );
  gameSlug = game.slug;
});

beforeEach(async () => {
  for (const slug of PLUGINS) {
    await registry().ensureInstalled(slug);
    await registry().activate(slug);
  }
});

// No afterAll DB work: the shared integration-setup afterAll closes the pool
// first, and the next spec's setup truncates.
afterEach(async () => {
  if (registry().isActive(PELICAN_PLUGIN_ID))
    await registry().deactivate(PELICAN_PLUGIN_ID);
});

describe('GET guilds/:id — guild.gameSlug (ROK-1909)', () => {
  it.each<GuildKind>(['wow_guild', 'game_server', 'game_community'])(
    '%s hub carries its game slug',
    async (kind) => {
      const id = await insertHub(kind);
      const res = await testApp.request
        .get(`/guilds/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect({ status: res.status, guild: res.body.guild }).toMatchObject({
        status: 200,
        guild: { id, kind, gameSlug },
      });
    },
  );
});
