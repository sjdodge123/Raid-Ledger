/**
 * ROK-1856 — the ROK-1831 L-5 hidden-hub rule on the armory routes, which are
 * keyed by character / map / server id (never a guild id). While the
 * character's server hub is hidden a member gets the core hub routes' 404
 * (`Guild not found`) on every read family + the claim, and loses the
 * character from the list; staff still get 200; un-hiding restores members.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Response } from 'superagent';
import { ValheimCharacterListResponseSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import { SettingsService } from '../../../../settings/settings.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { memberToken } from '../../../pelican/testing/pelican-integration.helpers';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { blobRelativePath } from '../../link/blobs/valheim-link-blob.store';
import { fakePng } from '../../link/blobs/valheim-link-blob.testing';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from '../valheim-armory-import.service';
import { ensureFixtureHubId } from '../valheim-armory-map-hub.helpers';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const SHA = 'a'.repeat(64); // map-shared-layer base map
const BASE = '/plugins/valheim/armory/characters';
const ORIGINAL_BLOB_DIR = process.env.VALHEIM_LINK_BLOB_DIR;
let testApp: TestApp;
let blobDir: string;
let gameId: number;
let member: string;
let admin: string;

interface Seeded {
  serverId: number;
  id: number;
  mapId: number;
  hubId: number;
}
let seeded: Seeded;

const registry = () => testApp.app.get(PluginRegistryService);
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Raw bytes for every response, so PNG / gzip / JSON read the same way. */
function binary(res: Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
const getAs = (url: string, token: string) =>
  testApp.request.get(url).set(auth(token)).buffer(true).parse(binary);

/** Hide or show the hub the way the operator does (core admin route). */
async function hide(hidden: boolean): Promise<void> {
  const res = await testApp.request
    .patch(`/guilds/${seeded.hubId}/hidden`)
    .set(auth(admin))
    .send({ hidden });
  expect(res.status).toBe(200);
}

async function makeServer(n: number): Promise<number> {
  const s = fakeServer(n);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  return row.id;
}

/** Character + shared-layer map on a hub'd server, plus its stored PNG. */
async function seed(n: number): Promise<Seeded> {
  const serverId = await makeServer(n);
  for (const name of ['character-vanilla', 'map-shared-layer']) {
    const row = valheimSnapshotRow(serverId, loadValheimFixture(name) as never);
    await testApp.db.insert(schema.valheimLinkSnapshots).values(row);
  }
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
  const M = schema.valheimMaps;
  const [m] = nonEmpty(
    await testApp.db
      .select({ id: M.id, profileId: M.profileId })
      .from(M)
      .where(eq(M.pelicanServerId, serverId)),
    'map',
  );
  if (m.profileId === null) throw new Error('map has no profile');
  await storePng(serverId);
  const hubId = await ensureFixtureHubId(testApp.db, serverId, gameId);
  return { serverId, id: m.profileId, mapId: m.id, hubId };
}

async function storePng(serverId: number): Promise<void> {
  const storagePath = blobRelativePath(serverId, SHA);
  const png = fakePng(8, 8);
  await mkdir(dirname(join(blobDir, storagePath)), { recursive: true });
  await writeFile(join(blobDir, storagePath), png);
  await testApp.db.insert(schema.valheimLinkBlobs).values({
    pelicanServerId: serverId,
    sha256: SHA,
    byteLength: png.length,
    contentType: 'image/png',
    width: 8,
    height: 8,
    storagePath,
  });
}

/** 404 with the core hub routes' body — not a character/map/blob 404. */
function expectHubNotFound(res: { status: number; body: unknown }) {
  expect(res.status).toBe(404);
  const text = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : '';
  expect(JSON.parse(text)).toMatchObject({ message: HUB_NOT_FOUND });
}

beforeAll(async () => {
  blobDir = await mkdtemp(join(tmpdir(), 'vh-hidden-hub-'));
  process.env.VALHEIM_LINK_BLOB_DIR = blobDir;
  testApp = await getTestApp();
});

afterAll(async () => {
  if (ORIGINAL_BLOB_DIR === undefined) delete process.env.VALHEIM_LINK_BLOB_DIR;
  else process.env.VALHEIM_LINK_BLOB_DIR = ORIGINAL_BLOB_DIR;
  await rm(blobDir, { recursive: true, force: true });
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  for (const slug of PLUGINS) {
    await registry().ensureInstalled(slug);
    await registry().activate(slug);
  }
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  gameId = g.id;
  member = await memberToken(testApp, 'alice');
  admin = await loginAsAdmin(testApp.request, testApp.seed);
  seeded = await seed(1);
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

/** Every character/server-keyed GET, by route family. */
const READS: Array<[string, (s: Seeded) => string]> = [
  ['character detail', (s) => `${BASE}/${s.id}`],
  ['map meta', (s) => `${BASE}/${s.id}/maps/${s.mapId}`],
  ['map bytes: base-map', (s) => `${BASE}/${s.id}/maps/${s.mapId}/base-map`],
  ['map bytes: fog', (s) => `${BASE}/${s.id}/maps/${s.mapId}/fog?layer=shared`],
  [
    'server blob',
    (s) => `/plugins/valheim/armory/servers/${s.serverId}/blobs/${SHA}`,
  ],
];

describe.each(READS)('hidden hub — %s (ROK-1856)', (_family, url) => {
  it('member 404 `Guild not found` while hidden', async () => {
    await hide(true);
    expectHubNotFound(await getAs(url(seeded), member));
  });

  it('staff still 200 while hidden', async () => {
    await hide(true);
    expect((await getAs(url(seeded), admin)).status).toBe(200);
  });

  it('member 200 again once un-hidden', async () => {
    await hide(true);
    await hide(false);
    expect((await getAs(url(seeded), member)).status).toBe(200);
  });
});

describe('hidden hub — character list (ROK-1856)', () => {
  const ids = async (token: string) => {
    const res = await testApp.request.get(BASE).set(auth(token));
    expect(res.status).toBe(200);
    const body = ValheimCharacterListResponseSchema.parse(res.body);
    return { ids: body.data.map((c) => c.id), total: body.total };
  };

  it('drops the hidden hub’s characters (and total) for a member', async () => {
    const other = await seed(2);
    await hide(true);
    expect(await ids(member)).toEqual({ ids: [other.id], total: 1 });
  });

  it('staff still list every character while hidden', async () => {
    const other = await seed(2);
    await hide(true);
    const got = await ids(admin);
    expect(got.ids.sort()).toEqual([seeded.id, other.id].sort());
    expect(got.total).toBe(2);
  });

  it('a member sees the character again once un-hidden', async () => {
    await hide(true);
    await hide(false);
    expect(await ids(member)).toEqual({ ids: [seeded.id], total: 1 });
  });
});

describe('hidden hub — claim (ROK-1856)', () => {
  const claim = (token: string) =>
    testApp.request
      .post(`${BASE}/${seeded.id}/claim`)
      .set(auth(token))
      .buffer(true)
      .parse(binary);

  it('member 404 `Guild not found` while hidden, and nothing is claimed', async () => {
    await hide(true);
    expectHubNotFound(await claim(member));
    const P = schema.valheimProfiles;
    const [row] = nonEmpty(
      await testApp.db
        .select({ claimedBy: P.claimedBy })
        .from(P)
        .where(eq(P.id, seeded.id)),
      'profile',
    );
    expect(row.claimedBy).toBeNull();
  });

  it('staff can still claim while hidden', async () => {
    await hide(true);
    expect((await claim(admin)).status).toBe(200);
  });

  it('member can claim again once un-hidden', async () => {
    await hide(true);
    await hide(false);
    expect((await claim(member)).status).toBe(200);
  });
});
