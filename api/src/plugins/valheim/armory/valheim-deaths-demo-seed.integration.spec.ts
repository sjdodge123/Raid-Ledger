/**
 * ROK-1930 L5 — POST /admin/test/valheim/deaths-fixture (integration, real
 * DB). The fixture gives each worker its own server hub with two mapped
 * characters, a name-only player, a hub member and a non-member visitor; the
 * real Deaths + death-pins routes read it back. 403 without DEMO_MODE.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  ValheimDeathPinsResponseSchema,
  ValheimDeathsResponseSchema,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../pelican/pelican.constants';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import type {
  DeathsFixture,
  DeathsFixtureUser,
} from './valheim-deaths-demo-seed.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/valheim/deaths-fixture';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

async function seed(body: object = {}): Promise<DeathsFixture> {
  const res = await testApp.request
    .post(ROUTE)
    .set(bearer(adminToken))
    .send(body);
  expect(res.status).toBe(200);
  return res.body as DeathsFixture;
}

/** A member-role session for a seeded (Discord-only, passwordless) user. */
function tokenFor(user: DeathsFixtureUser): Promise<string> {
  return signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
    role: 'member',
  });
}

async function readDeaths(f: DeathsFixture, user: DeathsFixtureUser) {
  return testApp.request
    .get(`/plugins/valheim/armory/servers/${f.serverId}/deaths`)
    .set(bearer(await tokenFor(user)));
}

async function deathRowCount(serverId: number): Promise<number> {
  const D = schema.valheimPlayerDeaths;
  const rows = await testApp.db
    .select({ id: D.id })
    .from(D)
    .where(eq(D.pelicanServerId, serverId));
  return rows.length;
}

beforeAll(async () => {
  process.env.VALHEIM_LINK_BLOB_DIR = await mkdtemp(
    join(tmpdir(), 'vh-deaths-fixture-'),
  );
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await setDemoMode(true);
  await testApp.db
    .insert(schema.games)
    .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG });
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
});

afterAll(() => {
  delete process.env.VALHEIM_LINK_BLOB_DIR;
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/valheim/deaths-fixture (ROK-1930 L5)', () => {
  it('seeds 5 / 3 / 1 deaths the member reads sorted, with the linked characters', async () => {
    const f = await seed({ worker: 2 });
    const res = await readDeaths(f, f.users.member);
    expect(res.status).toBe(200);
    const body = ValheimDeathsResponseSchema.parse(res.body);
    expect(body.players.map((p) => [p.name, p.deaths, p.characterId])).toEqual([
      [f.characters.top.name, 5, f.characters.top.id],
      [f.characters.second.name, 3, f.characters.second.id],
      [f.unlinked.name, 1, null],
    ]);
    expect(body.since).not.toBeNull();
    expect(f.characters.top.deathPinLabels).toEqual(['Day 12', 'Day 31']);
  });

  it("returns every character's Death pins on the world, and 404s the visitor", async () => {
    const f = await seed({ worker: 3 });
    const pins = await testApp.request
      .get(
        `/plugins/valheim/armory/servers/${f.serverId}/deaths/pins?worldUid=${f.worldUid}`,
      )
      .set(bearer(await tokenFor(f.users.member)));
    expect(pins.status).toBe(200);
    const names = ValheimDeathPinsResponseSchema.parse(pins.body)
      .pins.map((p) => p.characterName)
      .sort();
    const { top, second } = f.characters;
    expect(names).toEqual([second.name, top.name, top.name].sort());
    expect((await readDeaths(f, f.users.visitor)).status).toBe(404);
  });

  it('re-seeding a worker keeps the server, hub and users and does not double the deaths', async () => {
    const first = await seed({ worker: 1 });
    const again = await seed({ worker: 1 });
    expect(again.serverId).toBe(first.serverId);
    expect(again.guildId).toBe(first.guildId);
    expect(again.users).toEqual(first.users);
    expect(await deathRowCount(again.serverId)).toBe(9);
    const other = await seed({ worker: 4 });
    expect(other.serverId).not.toBe(first.serverId);
  });

  it('400s on a bad body; 403s a non-admin and without DEMO_MODE', async () => {
    const bad = await testApp.request
      .post(ROUTE)
      .set(bearer(adminToken))
      .send({ worker: 99 });
    expect(bad.status).toBe(400);
    const f = await seed();
    const asMember = await testApp.request
      .post(ROUTE)
      .set(bearer(await tokenFor(f.users.member)))
      .send({});
    expect(asMember.status).toBe(403);
    await setDemoMode(false);
    const off = await testApp.request
      .post(ROUTE)
      .set(bearer(adminToken))
      .send({});
    expect(off.status).toBe(403);
  });
});
