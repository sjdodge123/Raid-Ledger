/**
 * ROK-1837 T8 — POST /admin/test/valheim/map-fixture (integration, real
 * DB). The DEMO_MODE fixture seeds the caller's claimed character + map
 * whose generated base map and both fog layers the L2 byte routes serve;
 * `withBaseMap: false` leaves the base map not ready. Idempotent per
 * worker; 400 on a bad body; 403 without DEMO_MODE or for a non-admin.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Response } from 'superagent';
import { ValheimMapFixtureResponseSchema } from '@raid-ledger/contract';
import type { ValheimMapFixtureResponse } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../pelican/pelican.constants';
import { memberToken } from '../../pelican/testing/pelican-integration.helpers';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import {
  MAP_FIXTURE_EXPLORED,
  MAP_FIXTURE_PLACEHOLDER_SHA256,
  MAP_FIXTURE_SHARED_EXPLORED,
} from './valheim-armory-map-demo-fixture';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ORIGINAL_BLOB_DIR = process.env.VALHEIM_LINK_BLOB_DIR;
let blobDir: string;
const ROUTE = '/admin/test/valheim/map-fixture';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const mapUrl = (f: ValheimMapFixtureResponse) =>
  `/plugins/valheim/armory/characters/${f.characterId}/maps/${f.mapId}`;

function binary(res: Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function getBytes(url: string, token: string) {
  const res = await testApp.request
    .get(url)
    .set(bearer(token))
    .buffer(true)
    .parse(binary);
  return { res, body: res.body as Buffer };
}

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

const post = (body: object, token = adminToken) =>
  testApp.request.post(ROUTE).set(bearer(token)).send(body);

async function seed(body: object = {}): Promise<ValheimMapFixtureResponse> {
  const res = await post(body);
  expect(res.status).toBe(200);
  return ValheimMapFixtureResponseSchema.parse(res.body);
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  blobDir = await mkdtemp(join(tmpdir(), 'vh-map-seed-'));
  process.env.VALHEIM_LINK_BLOB_DIR = blobDir;
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await setDemoMode(true);
  nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'valheim game',
  );
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
});

afterAll(async () => {
  if (ORIGINAL_BLOB_DIR === undefined) delete process.env.VALHEIM_LINK_BLOB_DIR;
  else process.env.VALHEIM_LINK_BLOB_DIR = ORIGINAL_BLOB_DIR;
  await rm(blobDir, { recursive: true, force: true });
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/valheim/map-fixture (ROK-1837 T8)', () => {
  it('seeds a map whose generated 2048² base map + both fog layers a member reads', async () => {
    const f = await seed({ worker: 1 });
    expect(typeof f.guildId).toBe('number');
    const member = await memberToken(testApp, 'bob');
    const { res, body } = await getBytes(`${mapUrl(f)}/base-map`, member);
    expect(res.status).toBe(200);
    const sha = sha256(body);
    expect(res.headers.etag).toBe(`"${sha}"`);
    expect(sha).not.toBe(MAP_FIXTURE_PLACEHOLDER_SHA256);
    expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([
      2048, 2048,
    ]);
    const personal = await getBytes(`${mapUrl(f)}/fog?layer=personal`, member);
    expect(personal.body).toEqual(
      Buffer.from(MAP_FIXTURE_EXPLORED.data, 'base64'),
    );
    const shared = await getBytes(`${mapUrl(f)}/fog?layer=shared`, member);
    expect(shared.body).toEqual(
      Buffer.from(MAP_FIXTURE_SHARED_EXPLORED.data, 'base64'),
    );
  });

  it('claims the character for the caller', async () => {
    const f = await seed();
    const P = schema.valheimProfiles;
    const rows = await testApp.db.select({ id: P.id, by: P.claimedBy }).from(P);
    expect(rows).toEqual([
      { id: f.characterId, by: testApp.seed.adminUser.id },
    ]);
  });

  it('withBaseMap:false leaves the base map not ready', async () => {
    const f = await seed({ withBaseMap: false });
    const res = await testApp.request
      .get(`${mapUrl(f)}/base-map`)
      .set(bearer(adminToken));
    expect(res.status).toBe(404);
    expect((res.body as { message?: unknown }).message).toBe(
      'base_map_not_ready',
    );
  });
});

describe('map-fixture idempotence + guards (ROK-1837 T8)', () => {
  it('re-running is idempotent per worker', async () => {
    const first = await seed();
    const again = await seed();
    expect(again.pelicanServerId).toBe(first.pelicanServerId);
    expect(again.guildId).toBe(first.guildId);
    const G = schema.guilds;
    const hubs = await testApp.db
      .select({ id: G.id })
      .from(G)
      .where(eq(G.pelicanServerId, first.pelicanServerId));
    expect(hubs).toEqual([{ id: first.guildId }]);
    const M = schema.valheimMaps;
    const B = schema.valheimLinkBlobs;
    const maps = await testApp.db.select({ id: M.id }).from(M);
    expect(maps).toEqual([{ id: again.mapId }]);
    expect(await testApp.db.select({ sha: B.sha256 }).from(B)).toHaveLength(
      // atlas + mod icon (armory fixture) + base map
      3,
    );
    const { res } = await getBytes(`${mapUrl(again)}/base-map`, adminToken);
    expect(res.status).toBe(200);
  });

  it('replaces the base-map PNG atomically (a new file, never truncated in place)', async () => {
    const first = await seed();
    const pngPath = await baseMapPath(first.pelicanServerId);
    const before = await stat(pngPath);
    await seed();
    const after = await stat(pngPath);
    expect({ replacedInode: after.ino !== before.ino }).toEqual({
      replacedInode: true,
    });
  });

  it('401s when signed out', async () => {
    expect((await testApp.request.post(ROUTE).send({})).status).toBe(401);
  });

  it('400s on a bad body', async () => {
    for (const body of [
      { worker: 99 },
      { worker: 1.5 },
      { withBaseMap: 'yes' },
      { extra: 1 },
    ]) {
      expect({ body, status: (await post(body)).status }).toEqual({
        body,
        status: 400,
      });
    }
  });

  it('403s without DEMO_MODE', async () => {
    await setDemoMode(false);
    expect((await post({})).status).toBe(403);
  });

  it('403s for a non-admin', async () => {
    const member = await memberToken(testApp, 'bob');
    expect((await post({}, member)).status).toBe(403);
  });
});

/** The stored base-map file of `serverId` (the 2048² PNG's blob row). */
async function baseMapPath(serverId: number): Promise<string> {
  const B = schema.valheimLinkBlobs;
  const rows = await testApp.db
    .select({ rel: B.storagePath, w: B.width })
    .from(B)
    .where(eq(B.pelicanServerId, serverId));
  const [row] = nonEmpty(
    rows.filter((r) => r.w === 2048),
    'base-map blob row',
  );
  return join(blobDir, row.rel);
}

const ARMORY_ROUTE = '/admin/test/valheim/armory-character';
const seedC1 = async (): Promise<number> => {
  const res = await testApp.request
    .post(ARMORY_ROUTE)
    .set(bearer(adminToken))
    .send({ key: 'c1' });
  expect(res.status).toBe(200);
  return defined(
    (res.body as { characterId?: number }).characterId,
    'c1 character id',
  );
};
const profileIds = async () => {
  const P = schema.valheimProfiles;
  return (await testApp.db.select({ id: P.id }).from(P)).map((r) => r.id);
};

describe('map fixture vs the ROK-1836 c1 fixture (separate identities)', () => {
  it('c1 → map → c1: the map keeps its character and base map', async () => {
    await seedC1();
    const f = await seed();
    await seedC1();
    const M = schema.valheimMaps;
    const [row] = nonEmpty(
      await testApp.db
        .select({ profileId: M.profileId })
        .from(M)
        .where(eq(M.id, f.mapId)),
      'map row',
    );
    expect(row.profileId).toBe(f.characterId);
    const { res } = await getBytes(`${mapUrl(f)}/base-map`, adminToken);
    expect(res.status).toBe(200);
  });

  it('map → c1 → map: the c1 character survives the map re-seed', async () => {
    await seed();
    const c1 = await seedC1();
    await seed();
    expect(await profileIds()).toContain(c1);
  });
});
