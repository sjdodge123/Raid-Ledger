/**
 * ROK-1941 L6 — POST /admin/test/valheim/death-pictures (integration, real
 * DB). Links `count` generated death pictures (+ optionally one hidden and
 * one removed) to the worker's Deaths-fixture `top` character; the real
 * Deaths read serves them newest first. Idempotent per worker; 403 without
 * DEMO_MODE or for a non-admin, like its siblings.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, inArray, isNotNull, like } from 'drizzle-orm';
import { ValheimDeathsResponseSchema } from '@raid-ledger/contract';
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
import type { DeathsFixtureUser } from './valheim-deaths-demo-seed.helpers';
import type { DeathPicturesFixture } from './valheim-death-pictures-demo-seed.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/valheim/death-pictures';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

const post = (body: object, token = adminToken) =>
  testApp.request.post(ROUTE).set(bearer(token)).send(body);

async function seed(body: object): Promise<DeathPicturesFixture> {
  const res = await post(body);
  expect(res.status).toBe(200);
  return res.body as DeathPicturesFixture;
}

function tokenFor(user: DeathsFixtureUser): Promise<string> {
  return signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
    role: 'member',
  });
}

async function topBar(f: DeathPicturesFixture, user: DeathsFixtureUser) {
  const res = await testApp.request
    .get(`/plugins/valheim/armory/servers/${f.serverId}/deaths`)
    .set(bearer(await tokenFor(user)));
  expect(res.status).toBe(200);
  const body = ValheimDeathsResponseSchema.parse(res.body);
  return body.players.find((p) => p.name === f.characterName);
}

/** The guild's demo death-picture rows, and the deaths linked to them. */
async function demoRows(f: DeathPicturesFixture) {
  const M = schema.hubMedia;
  const media = await testApp.db
    .select({ id: M.id, kind: M.kind, author: M.authorName })
    .from(M)
    .where(
      and(eq(M.guildId, f.guildId), like(M.provenanceKey, 'demo-death:%')),
    );
  const D = schema.valheimPlayerDeaths;
  const ids = media.map((m) => m.id);
  const linked =
    ids.length === 0
      ? []
      : await testApp.db
          .select({ id: D.id, name: D.characterName })
          .from(D)
          .where(and(isNotNull(D.hubMediaId), inArray(D.hubMediaId, ids)));
  return { media, linked };
}

beforeAll(async () => {
  process.env.VALHEIM_LINK_BLOB_DIR = await mkdtemp(
    join(tmpdir(), 'vh-death-pictures-'),
  );
  process.env.HUB_MEDIA_DIR = await mkdtemp(join(tmpdir(), 'vh-dp-media-'));
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
  delete process.env.HUB_MEDIA_DIR;
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/valheim/death-pictures (ROK-1941 L6)', () => {
  it('links count death pictures to the top character; the member reads them newest first', async () => {
    const f = await seed({ worker: 2, count: 5 });
    expect(f.mediaIds).toHaveLength(5);
    const { media, linked } = await demoRows(f);
    expect(media.map((m) => [m.kind, m.author])).toEqual(
      Array.from({ length: 5 }, () => ['death', f.characterName]),
    );
    expect(linked.map((d) => d.name)).toEqual(
      Array.from({ length: 5 }, () => f.characterName),
    );
    const bar = await topBar(f, f.users.member);
    expect(bar?.pictureCount).toBe(5);
    expect(bar?.pictures?.map((p) => p.mediaId)).toEqual(
      f.mediaIds.slice(0, 3),
    );
  });

  it('reuses the deaths-fixture hub and replaces its own pictures on a re-run', async () => {
    const fixture = await testApp.request
      .post('/admin/test/valheim/deaths-fixture')
      .set(bearer(adminToken))
      .send({ worker: 1 });
    expect(fixture.status).toBe(200);
    const first = await seed({ worker: 1, count: 4 });
    expect(first.serverId).toBe(fixture.body.serverId);
    expect(first.guildId).toBe(fixture.body.guildId);
    const again = await seed({ worker: 1, count: 2 });
    expect(again.users).toEqual(first.users);
    const { media, linked } = await demoRows(again);
    expect(media.map((m) => m.id).sort()).toEqual([...again.mediaIds].sort());
    expect(linked).toHaveLength(2);
    expect((await topBar(again, again.users.member))?.pictureCount).toBe(2);
  });

  it('adds one hidden and one removed picture nobody reads', async () => {
    const f = await seed({ worker: 3, count: 2, hidden: true, removed: true });
    const M = schema.hubMedia;
    const ids = [f.hiddenMediaId, f.removedMediaId].filter(
      (id): id is number => id !== null,
    );
    expect(ids).toHaveLength(2);
    const rows = await testApp.db
      .select({ id: M.id, hiddenAt: M.hiddenAt, removedAt: M.removedAt })
      .from(M)
      .where(inArray(M.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(f.hiddenMediaId ?? 0)?.hiddenAt).not.toBeNull();
    expect(byId.get(f.removedMediaId ?? 0)?.removedAt).not.toBeNull();
    expect((await topBar(f, f.users.member))?.pictureCount).toBe(2);
  });

  it('ROK-2027: secondCount pictures go to the second bar; screenshot adds one non-death picture', async () => {
    const f = await seed({
      worker: 5,
      count: 2,
      secondCount: 3,
      screenshot: true,
    });
    expect(f.secondMediaIds).toHaveLength(3);
    expect(f.screenshotMediaId).not.toBeNull();
    const { media, linked } = await demoRows(f);
    const kinds = media.map((m) => m.kind).sort();
    expect(kinds).toEqual([
      'death',
      'death',
      'death',
      'death',
      'death',
      'screenshot',
    ]);
    expect(linked.filter((d) => d.name === f.secondCharacterName)).toHaveLength(
      3,
    );
    const res = await testApp.request
      .get(`/plugins/valheim/armory/servers/${f.serverId}/deaths`)
      .set(bearer(await tokenFor(f.users.member)));
    const players = ValheimDeathsResponseSchema.parse(res.body).players;
    const second = players.find((p) => p.name === f.secondCharacterName);
    expect(second?.pictureCount).toBe(3);
    expect(second?.pictures?.map((p) => p.mediaId)).toEqual(f.secondMediaIds);
    expect((await topBar(f, f.users.member))?.pictureCount).toBe(2);
  });

  it('400s on a bad body; 403s a non-admin and without DEMO_MODE', async () => {
    expect((await post({ worker: 1, count: 0 })).status).toBe(400);
    expect((await post({ worker: 1, nope: true })).status).toBe(400);
    const f = await seed({ worker: 4, count: 1 });
    expect((await post({}, await tokenFor(f.users.member))).status).toBe(403);
    await setDemoMode(false);
    expect((await post({ worker: 4 })).status).toBe(403);
  });
});
