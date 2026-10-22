/**
 * ROK-1889 — `GET …/chest-focus` against a real database, beyond the cases in
 * `valheim-materials.integration.spec.ts`: an admin's view of a personal
 * chest, and `y` picking the right chest out of a same-prefab stack.
 * Containers go through the real snapshot → importer path.
 */
import { ValheimChestFocusSchema } from '@raid-ledger/contract';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { SettingsService } from '../../../../settings/settings.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from '../valheim-armory-import.service';
import { ensureFixtureHubId } from '../valheim-armory-map-hub.helpers';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const OTHER_PID = '1000000000000002';
const T0 = '2026-10-17T20:15:42Z';

let testApp: TestApp;
let server: number;
let admin: string;
let member: string;

type Box = Record<string, unknown>;
const registry = () => testApp.app.get(PluginRegistryService);
const item = (prefab: string, stack: number) => ({
  prefab,
  quality: 1,
  stack,
});
const box = (over: Box): Box => ({
  prefab: 'piece_chest',
  x: 0,
  y: 30,
  z: 0,
  creatorPlayerId: OTHER_PID,
  privacy: 'public',
  vehicle: false,
  slots: 30,
  usedSlots: 1,
  unreadable: false,
  omittedEntries: 0,
  items: [],
  ...over,
});

/** Two same-prefab chests stacked at 0,0 + another player's private chest. */
async function importWorld(): Promise<void> {
  const msg = {
    ...loadValheimFixture('containers-basic'),
    capturedAt: T0,
    containers: [
      box({ y: 31.5, usedSlots: 2, items: [item('Wood', 7)] }),
      box({ y: 30, items: [item('Wood', 50)] }),
      box({
        prefab: 'piece_chest_private',
        x: 5,
        z: 5,
        privacy: 'private',
        items: [item('Gold', 3)],
      }),
    ],
  };
  await testApp.db
    .insert(schema.valheimLinkSnapshots)
    .values(valheimSnapshotRow(server, msg as never));
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
}

async function seedServer(): Promise<void> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  const s = fakeServer(1);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId: g.id,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  server = row.id;
  await ensureFixtureHubId(testApp.db, server, g.id);
}

async function memberToken(): Promise<string> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'local:member', username: 'member' })
      .returning({ id: schema.users.id }),
    'member',
  );
  return signTestAccessToken(testApp, { sub: u.id, username: 'member' });
}

const focus = (t: string, q: string) =>
  testApp.request
    .get(`/plugins/valheim/armory/servers/${server}/chest-focus?${q}`)
    .set({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  for (const slug of PLUGINS) {
    await registry().ensureInstalled(slug);
    await registry().activate(slug);
  }
  await seedServer();
  admin = await loginAsAdmin(testApp.request, testApp.seed);
  member = await memberToken();
  await importWorld();
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('chest focus — admin + stacked chests (ROK-1889)', () => {
  it("an admin sees another player's personal chest; a member gets 404", async () => {
    const q = 'prefab=piece_chest_private&x=5.0&z=5.0&item=Gold';
    const res = await focus(admin, q);
    expect(res.status).toBe(200);
    expect(ValheimChestFocusSchema.parse(res.body)).toMatchObject({
      prefab: 'piece_chest_private',
      privacy: 'personal',
      held: { prefab: 'Gold', count: 3 },
    });
    expect((await focus(member, q)).status).toBe(404);
  });

  it('y picks the upper chest of a same-prefab stack; no y → the lowest', async () => {
    const q = 'prefab=piece_chest&x=0.0&z=0.0&item=Wood';
    const upper = await focus(member, `${q}&y=31.5`);
    expect(upper.status).toBe(200);
    expect(upper.body).toMatchObject({
      y: 31.5,
      usedSlots: 2,
      held: { prefab: 'Wood', count: 7 },
    });
    const lowest = await focus(member, q);
    expect(lowest.status).toBe(200);
    expect(lowest.body).toMatchObject({
      y: 30,
      usedSlots: 1,
      held: { prefab: 'Wood', count: 50 },
    });
    expect((await focus(member, `${q}&y=40.0`)).status).toBe(404);
  });
});
