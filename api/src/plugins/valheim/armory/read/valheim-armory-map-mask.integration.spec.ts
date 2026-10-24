/**
 * ROK-1949 T4 — the base-map route serves the PNG masked to the VIEWER's
 * exploration (own claimed characters' personal ∪ shared, plus the viewed
 * map's shared layer), fails closed, and the blob route refuses base maps.
 * Synthetic 256² world: owner personal = west half, map shared = NE
 * quadrant, member B's own character on the same world = SE quadrant.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import type { Response } from 'superagent';
import { ValheimLinkMessageSchema } from '@raid-ledger/contract';
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
import { memberToken } from '../../../pelican/testing/pelican-integration.helpers';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { blobRelativePath } from '../../link/blobs/valheim-link-blob.store';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from '../valheim-armory-import.service';
import { ValheimMapMaskCache } from './valheim-map-mask.cache';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const N = 256;
const SHA = 'a'.repeat(64); // map-shared-layer's base map
const ICON_SHA = 'c'.repeat(64);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const P = schema.valheimProfiles;
const M = schema.valheimMaps;
let testApp: TestApp;
let blobDir: string;
let source: Buffer; // the stored (unmasked) PNG
const ORIGINAL_BLOB_DIR = process.env.VALHEIM_LINK_BLOB_DIR;

type Pred = (px: number, py: number) => boolean;
const WEST: Pred = (px) => px < N / 2;
const NE: Pred = (px, py) => px >= N / 2 && py >= N / 2;
const SE: Pred = (px, py) => px >= N / 2 && py < N / 2;
/** World points (py = north-up) probing each region. */
const AT = { west: [50, 100], ne: [200, 200], se: [200, 50] } as const;

/** gzip+base64 lsb0 bitset, bit `py·n + px` set where `pred` holds. */
function bitmap(pred: Pred) {
  const bytes = Buffer.alloc((N * N) / 8);
  for (let py = 0; py < N; py += 1) {
    for (let px = 0; px < N; px += 1) {
      const i = py * N + px;
      if (pred(px, py)) bytes[i >> 3] = (bytes[i >> 3] ?? 0) | (1 << (i & 7));
    }
  }
  return {
    encoding: 'gzip+base64-bitset-lsb0' as const,
    width: N,
    height: N,
    data: gzipSync(bytes).toString('base64'),
  };
}

/** Every pixel distinct: R = px, G = PNG row, B = 77, opaque. */
async function sourcePng(n = N): Promise<Buffer> {
  const raw = Buffer.alloc(n * n * 3);
  for (let r = 0; r < n; r += 1) {
    for (let px = 0; px < n; px += 1)
      raw.set([px & 255, r & 255, 77], (r * n + px) * 3);
  }
  return sharp(raw, { raw: { width: n, height: n, channels: 3 } })
    .png()
    .toBuffer();
}

/** RGBA of world point `(px, py)` in a decoded PNG (row = n − 1 − py). */
async function rgbaAt(png: Buffer, [px, py]: readonly [number, number]) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect({ w: info.width, h: info.height }).toEqual({ w: N, h: N });
  const o = ((N - 1 - py) * N + px) * 4;
  return [...data.subarray(o, o + 4)];
}
const sourceAt = ([px, py]: readonly [number, number]) => [
  px,
  N - 1 - py,
  77,
  255,
];
const CLEAR = [0, 0, 0, 0];

function binary(res: Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
const get = (
  url: string,
  token: string,
  headers: Record<string, string> = {},
) =>
  testApp.request
    .get(url)
    .set({ Authorization: `Bearer ${token}`, ...headers })
    .buffer(true)
    .parse(binary);

interface World {
  serverId: number;
  url: string;
  owner: string;
  bob: string;
  carol: string;
  dave: string;
  admin: string;
}
let w: World;

async function userId(username: string): Promise<number> {
  const U = schema.users;
  const [u] = nonEmpty(
    await testApp.db
      .select({ id: U.id })
      .from(U)
      .where(eq(U.username, username)),
    username,
  );
  return u.id;
}

async function storeBlob(serverId: number, sha: string, bytes: Buffer) {
  const rel = blobRelativePath(serverId, sha);
  await mkdir(dirname(join(blobDir, rel)), { recursive: true });
  await writeFile(join(blobDir, rel), bytes);
  await testApp.db.insert(schema.valheimLinkBlobs).values({
    pelicanServerId: serverId,
    sha256: sha,
    byteLength: bytes.length,
    contentType: 'image/png',
    width: N,
    height: N,
    storagePath: rel,
  });
}

/** Owner's character + map (imported), then B's character on the same world. */
async function seedWorld(): Promise<World> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  const s = fakeServer(1);
  const [srv] = nonEmpty(
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
  const serverId = srv.id;
  for (const name of ['character-vanilla', 'map-shared-layer']) {
    const msg = ValheimLinkMessageSchema.parse(loadValheimFixture(name));
    await testApp.db
      .insert(schema.valheimLinkSnapshots)
      .values(valheimSnapshotRow(serverId, msg));
  }
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
  const [map] = nonEmpty(
    await testApp.db.select().from(M).where(eq(M.pelicanServerId, serverId)),
    'map',
  );
  const [prof] = nonEmpty(
    await testApp.db.select().from(P).where(eq(P.pelicanServerId, serverId)),
    'profile',
  );
  const tokens = {
    owner: await memberToken(testApp, 'alice'),
    bob: await memberToken(testApp, 'bob'),
    carol: await memberToken(testApp, 'carol'),
    dave: await memberToken(testApp, 'dave'),
    admin: await loginAsAdmin(testApp.request, testApp.seed),
  };
  const claim = (uid: number) => ({
    claimedBy: uid,
    claimSource: 'manual' as const,
    claimedAt: new Date(),
  });
  await testApp.db
    .update(P)
    .set(claim(await userId('alice')))
    .where(eq(P.id, prof.id));
  await testApp.db
    .update(M)
    .set({
      textureSize: N,
      explored: bitmap(WEST),
      sharedExplored: bitmap(NE),
      baseMapSha256: SHA,
    })
    .where(eq(M.id, map.id));
  const { id: profId, ...profRest } = prof;
  const [bProf] = nonEmpty(
    await testApp.db
      .insert(P)
      .values({
        ...profRest,
        steamId: '76561190000000002',
        ...claim(await userId('bob')),
      })
      .returning({ id: P.id }),
    'bob profile',
  );
  const { id: mapId, ...mapRest } = map;
  await testApp.db.insert(M).values({
    ...mapRest,
    steamId: '76561190000000002',
    profileId: bProf.id,
    textureSize: N,
    explored: bitmap(SE),
    sharedExplored: null,
    baseMapSha256: SHA,
  });
  await storeBlob(serverId, SHA, source);
  const url = `/plugins/valheim/armory/characters/${profId}/maps/${mapId}/base-map`;
  return { serverId, url, ...tokens };
}

beforeAll(async () => {
  blobDir = await mkdtemp(join(tmpdir(), 'vh-map-mask-'));
  process.env.VALHEIM_LINK_BLOB_DIR = blobDir;
  source = await sourcePng();
  testApp = await getTestApp();
});

afterAll(async () => {
  if (ORIGINAL_BLOB_DIR === undefined) delete process.env.VALHEIM_LINK_BLOB_DIR;
  else process.env.VALHEIM_LINK_BLOB_DIR = ORIGINAL_BLOB_DIR;
  await rm(blobDir, { recursive: true, force: true });
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  const registry = testApp.app.get(PluginRegistryService);
  for (const slug of PLUGINS) {
    await registry.ensureInstalled(slug);
    await registry.activate(slug);
  }
  w = await seedWorld();
});

afterEach(async () => {
  const registry = testApp.app.get(PluginRegistryService);
  for (const slug of PLUGINS) {
    if (registry.isActive(slug)) await registry.deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('base-map mask — per viewer (ROK-1949 D1/D3)', () => {
  it('owner: personal ∪ shared byte-identical to the source; unexplored is 0,0,0,0', async () => {
    const res = await get(w.url, w.owner);
    expect(res.status).toBe(200);
    const png = res.body as Buffer;
    expect(png.subarray(0, 8)).toEqual(PNG_SIG);
    expect(Buffer.compare(png, source)).not.toBe(0);
    expect(await rgbaAt(png, AT.west)).toEqual(sourceAt(AT.west));
    expect(await rgbaAt(png, AT.ne)).toEqual(sourceAt(AT.ne));
    expect(await rgbaAt(png, AT.se)).toEqual(CLEAR);
  });

  it('no-claim member and staff see only the shared layer, sharing one ETag', async () => {
    const carol = await get(w.url, w.carol);
    expect(carol.status).toBe(200);
    expect(await rgbaAt(carol.body as Buffer, AT.west)).toEqual(CLEAR);
    expect(await rgbaAt(carol.body as Buffer, AT.se)).toEqual(CLEAR);
    expect(await rgbaAt(carol.body as Buffer, AT.ne)).toEqual(sourceAt(AT.ne));
    const admin = await get(w.url, w.admin);
    expect(admin.headers.etag).toBe(carol.headers.etag); // no staff bypass
    expect(Buffer.compare(admin.body as Buffer, carol.body as Buffer)).toBe(0);
  });

  it("member B's own claimed character on the world unmasks B's area of the owner's map", async () => {
    const bob = await get(w.url, w.bob);
    expect(bob.status).toBe(200);
    expect(await rgbaAt(bob.body as Buffer, AT.se)).toEqual(sourceAt(AT.se));
    expect(await rgbaAt(bob.body as Buffer, AT.ne)).toEqual(sourceAt(AT.ne));
    expect(await rgbaAt(bob.body as Buffer, AT.west)).toEqual(CLEAR);
    const owner = await get(w.url, w.owner);
    const carol = await get(w.url, w.carol);
    expect(
      new Set([bob.headers.etag, owner.headers.etag, carol.headers.etag]).size,
    ).toBe(3);
  });

  it('two viewers with identical exploration share one cached render', async () => {
    const cache = testApp.app.get(ValheimMapMaskCache);
    const before = cache.stats().entries;
    const carol = await get(w.url, w.carol);
    const dave = await get(w.url, w.dave);
    expect(dave.headers.etag).toBe(carol.headers.etag);
    expect(cache.stats().entries - before).toBe(1);
  });
});

describe('base-map mask — validators and headers (ROK-1949 D7)', () => {
  it('m1 ETag, Vary: Authorization, private revalidate; old sha ETag → 200; match → 304', async () => {
    const res = await get(w.url, w.owner);
    const etag = String(res.headers.etag);
    expect(etag).toMatch(/^"m1-[0-9a-f]{40}"$/);
    expect(res.headers.vary).toContain('Authorization');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    const old = await get(w.url, w.owner, { 'If-None-Match': `"${SHA}"` });
    expect(old.status).toBe(200);
    const hit = await get(w.url, w.owner, { 'If-None-Match': etag });
    expect(hit.status).toBe(304);
    expect((hit.body as Buffer).length).toBe(0);
  });

  it('a newer snapshot of a contributing layer rotates the ETag', async () => {
    const first = await get(w.url, w.owner);
    await testApp.db
      .update(M)
      .set({ capturedAt: new Date(Date.now() + 60_000) })
      .where(eq(M.baseMapSha256, SHA));
    const second = await get(w.url, w.owner);
    expect(second.status).toBe(200);
    expect(second.headers.etag).not.toBe(first.headers.etag);
  });
});

describe('base-map mask — fail closed (ROK-1949 D5)', () => {
  it.each([
    ['a PNG of the wrong size', () => sourcePng(128)],
    ['corrupt bytes', () => Promise.resolve(Buffer.from('not a png at all'))],
  ])(
    '404 base_map_not_ready, never the stored bytes, for %s',
    async (_l, make) => {
      const bad = await make();
      await writeFile(join(blobDir, blobRelativePath(w.serverId, SHA)), bad);
      const res = await get(w.url, w.owner);
      expect(res.status).toBe(404);
      const body = res.body as Buffer;
      expect(body.toString()).toContain('base_map_not_ready');
      expect(body.subarray(0, 8)).not.toEqual(PNG_SIG);
      expect(res.headers['cache-control']).toBe('no-store');
    },
  );
});

describe('blob route refuses base maps (ROK-1949 D8)', () => {
  it('404s the base-map sha while an icon blob on the same server still serves', async () => {
    const blobs = `/plugins/valheim/armory/servers/${w.serverId}/blobs`;
    await storeBlob(w.serverId, ICON_SHA, source);
    const base = await get(`${blobs}/${SHA}`, w.owner);
    expect(base.status).toBe(404);
    expect((base.body as Buffer).subarray(0, 8)).not.toEqual(PNG_SIG);
    const icon = await get(`${blobs}/${ICON_SHA}`, w.owner);
    expect(icon.status).toBe(200);
  });
});
