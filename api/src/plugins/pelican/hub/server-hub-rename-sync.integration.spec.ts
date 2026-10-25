/**
 * ROK-1950 A1 — a renamed server hub against a real database. The rename
 * route itself is A2 (`hub-rename.integration.spec.ts`); here the override is
 * set directly on `guilds.name_overridden` and the Pelican side is proven:
 * `syncServerHub` (run by every admin PATCH of a server) keeps the custom name
 * but still moves the game, a cleared override follows the server name again,
 * and the `sourceName` hook + the page's `server.serverName` report the
 * server's own name (what a reset goes back to).
 *
 * Mutations (recorded for the Lead): drop the `name_overridden = false`
 * condition in `syncServerHub` → "keeps a custom name" goes red; make the
 * name copy never fire → "follows the server name" goes red.
 */
import { eq } from 'drizzle-orm';
import { GuildPageSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../pelican.constants';
import { fakeServer } from '../testing/pelican-fixtures';
import { PelicanHubKindAdapter } from './pelican-hub-kind.adapter';

type GuildRow = typeof schema.guilds.$inferSelect;

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const adapter = () => testApp.app.get(PelicanHubKindAdapter);
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const patchServer = (id: number, body: object) =>
  testApp.request
    .patch(`/admin/plugins/pelican/servers/${id}`)
    .set(auth())
    .send(body);

/** A mapped server named "Valheim Main" with its hub switched on. */
async function serverWithHub(): Promise<{ serverId: number; guildId: number }> {
  const s = fakeServer(1);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: 'Valheim Main',
        gameId: testApp.seed.game.id,
        currentState: 'running',
        statusCheckedAt: new Date(),
        lastSyncedAt: new Date(),
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  expect((await patchServer(row.id, { communityHub: true })).status).toBe(200);
  return { serverId: row.id, guildId: (await hubOf(row.id)).id };
}

async function hubOf(serverId: number): Promise<GuildRow> {
  const rows = await testApp.db
    .select()
    .from(schema.guilds)
    .where(eq(schema.guilds.pelicanServerId, serverId));
  expect(rows).toHaveLength(1);
  return nonEmpty(rows, 'hub')[0];
}

/** What A2's rename writes for a server hub (D4). */
async function renameHub(guildId: number, name: string): Promise<void> {
  await testApp.db
    .update(schema.guilds)
    .set({ name, nameKey: name.toLowerCase(), nameOverridden: true })
    .where(eq(schema.guilds.id, guildId));
}

async function renameServer(serverId: number, name: string): Promise<void> {
  await testApp.db
    .update(schema.pelicanServers)
    .set({ name })
    .where(eq(schema.pelicanServers.id, serverId));
}

async function otherGame(): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Rename Sync Game', slug: 'rename-sync-game' })
      .returning({ id: schema.games.id }),
    'game',
  );
  return g.id;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await registry().ensureInstalled(PELICAN_PLUGIN_ID);
  await registry().activate(PELICAN_PLUGIN_ID);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  if (registry().isActive(PELICAN_PLUGIN_ID))
    await registry().deactivate(PELICAN_PLUGIN_ID);
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('syncServerHub with a Raid Ledger name (ROK-1950 D6)', () => {
  it('a new server hub starts with no override', async () => {
    const { serverId } = await serverWithHub();
    expect(await hubOf(serverId)).toMatchObject({
      name: 'Valheim Main',
      nameOverridden: false,
    });
  });

  it('keeps a custom name across an unrelated admin PATCH, even after a panel rename', async () => {
    const { serverId, guildId } = await serverWithHub();
    await renameHub(guildId, 'Custom');
    await renameServer(serverId, 'Valheim Renamed');
    await patchServer(serverId, { showOnCalendar: false }).expect(200);
    expect(await hubOf(serverId)).toMatchObject({
      name: 'Custom',
      nameKey: 'custom',
      nameOverridden: true,
    });
  });

  it('still moves the hub to a remapped game while keeping the custom name', async () => {
    const { serverId, guildId } = await serverWithHub();
    await renameHub(guildId, 'Custom');
    const gameId = await otherGame();
    await patchServer(serverId, { gameId }).expect(200);
    expect(await hubOf(serverId)).toMatchObject({
      gameId,
      name: 'Custom',
      nameKey: 'custom',
      nameOverridden: true,
    });
  });

  it('follows the server name when there is no override (ROK-1831 regression)', async () => {
    const { serverId } = await serverWithHub();
    await renameServer(serverId, 'Valheim Renamed');
    await patchServer(serverId, { showOnCalendar: false }).expect(200);
    expect(await hubOf(serverId)).toMatchObject({
      name: 'Valheim Renamed',
      nameKey: 'valheim renamed',
      nameOverridden: false,
    });
  });

  it('a cleared mapping hides the hub and keeps the override', async () => {
    const { serverId, guildId } = await serverWithHub();
    await renameHub(guildId, 'Custom');
    await patchServer(serverId, { gameId: null }).expect(200);
    const hub = await hubOf(serverId);
    expect(hub.hiddenAt).not.toBeNull();
    expect(hub).toMatchObject({ name: 'Custom', nameOverridden: true });
  });
});

describe('clearing the override and the kind check (ROK-1950)', () => {
  it('once the override is cleared the next sync falls back to the server name', async () => {
    const { serverId, guildId } = await serverWithHub();
    await renameHub(guildId, 'Custom');
    await renameServer(serverId, 'Valheim Renamed');
    await testApp.db
      .update(schema.guilds)
      .set({ nameOverridden: false })
      .where(eq(schema.guilds.id, guildId));
    await patchServer(serverId, { showOnCalendar: false }).expect(200);
    expect(await hubOf(serverId)).toMatchObject({
      name: 'Valheim Renamed',
      nameKey: 'valheim renamed',
      nameOverridden: false,
    });
  });

  it('the DB refuses an override on a community hub', async () => {
    const insert = testApp.db.insert(schema.guilds).values({
      gameId: testApp.seed.game.id,
      kind: 'game_community',
      name: 'Crew',
      nameKey: 'crew',
      region: 'community',
      source: 'community',
      nameOverridden: true,
    });
    await expect(insert).rejects.toThrow(/guilds_name_override_kind_check/);
  });
});

describe('the server hub source name (ROK-1950 D5)', () => {
  it('sourceName answers the Pelican server name, and null once unlinked', async () => {
    const { guildId } = await serverWithHub();
    await renameHub(guildId, 'Custom');
    expect(await adapter().sourceName(guildId)).toBe('Valheim Main');
    await testApp.db
      .update(schema.guilds)
      .set({ pelicanServerId: null })
      .where(eq(schema.guilds.id, guildId));
    expect(await adapter().sourceName(guildId)).toBeNull();
  });

  it('the hub page carries server.serverName next to the custom hub name', async () => {
    const { guildId } = await serverWithHub();
    await renameHub(guildId, 'Our Viking Home');
    const res = await testApp.request.get(`/guilds/${guildId}`).set(auth());
    expect(res.status).toBe(200);
    const page = GuildPageSchema.parse(res.body);
    expect(page.guild.name).toBe('Our Viking Home');
    expect(page.server?.serverName).toBe('Valheim Main');
  });
});
