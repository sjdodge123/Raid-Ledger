/**
 * ROK-1836 D8 — POST /admin/test/valheim/armory-character (integration,
 * real DB). The DEMO_MODE fixture seeds a character a member can read —
 * catalogue subset + a ready atlas whose bytes the blob route serves — or a
 * bare one with `withCatalog: false`; `claimedBy` claims it. 403 without
 * DEMO_MODE.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Response } from 'superagent';
import { ValheimCharacterDetailSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../pelican/pelican.constants';
import { memberToken } from '../../pelican/testing/pelican-integration.helpers';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import type { ArmoryCharacterFixture } from './valheim-armory-demo-seed.controller';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/valheim/armory-character';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

function binary(res: Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

async function seed(body: object = {}): Promise<ArmoryCharacterFixture> {
  const res = await testApp.request
    .post(ROUTE)
    .set(bearer(adminToken))
    .send(body);
  expect(res.status).toBe(200);
  return res.body as ArmoryCharacterFixture;
}

async function readDetail(id: number, token: string) {
  const res = await testApp.request
    .get(`/plugins/valheim/armory/characters/${id}`)
    .set(bearer(token));
  expect(res.status).toBe(200);
  return ValheimCharacterDetailSchema.parse(res.body);
}

beforeAll(async () => {
  process.env.VALHEIM_LINK_BLOB_DIR = await mkdtemp(
    join(tmpdir(), 'vh-armory-seed-'),
  );
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
  delete process.env.VALHEIM_LINK_BLOB_DIR;
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  await testApp.app.get(SettingsService).setDemoMode(false);
});

describe('POST /admin/test/valheim/armory-character (ROK-1836 D8)', () => {
  it('seeds an unclaimed character a member can read, with a servable atlas', async () => {
    const seeded = await seed();
    expect(seeded.guildId).toBeNull();
    const member = await memberToken(testApp, 'bob');
    const detail = await readDetail(seeded.characterId, member);
    expect(detail.pelicanServerId).toBe(seeded.serverId);
    expect(detail.claimedBy).toBeNull();
    expect(Object.keys(detail.items ?? {}).sort()).toEqual([
      'HelmetBronze',
      'SwordIron',
      'TrophyBoar',
      'Wood',
    ]);
    expect(detail.atlas).toMatchObject({ width: 256, height: 64, ready: true });
    const sha = detail.atlas?.sha256 ?? 'missing';
    const blob = await testApp.request
      .get(`/plugins/valheim/armory/servers/${seeded.serverId}/blobs/${sha}`)
      .set(bearer(member))
      .buffer(true)
      .parse(binary);
    expect(blob.status).toBe(200);
    expect((blob.body as Buffer).subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('withCatalog:false seeds a bare sheet; claimedBy claims it; re-run resets', async () => {
    const first = await seed();
    const adminId = testApp.seed.adminUser.id;
    const seeded = await seed({ withCatalog: false, claimedBy: adminId });
    expect(seeded.serverId).toBe(first.serverId);
    const detail = await readDetail(seeded.characterId, adminToken);
    expect(detail.items).toEqual({});
    expect(detail.atlas).toBeNull();
    expect(detail.claimedBy?.id).toBe(adminId);
    const P = schema.valheimProfiles;
    expect(await testApp.db.select({ id: P.id }).from(P)).toHaveLength(1);
  });

  it('400s on a bad body', async () => {
    for (const body of [
      { slot: 99 },
      { withCatalog: 'yes' },
      { claimedBy: 0 },
      { extra: 1 },
    ]) {
      const res = await testApp.request
        .post(ROUTE)
        .set(bearer(adminToken))
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it('403s without DEMO_MODE', async () => {
    await setDemoMode(false);
    const res = await testApp.request
      .post(ROUTE)
      .set(bearer(adminToken))
      .send({});
    expect(res.status).toBe(403);
  });
});
