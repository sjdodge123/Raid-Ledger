/**
 * ROK-1837 L2 (T7) — the map tab's byte routes against a real database:
 * the base-map PNG is located by the MAP's `(server, sha256)` →
 * `storage_path` only and never leaves the blob root; fog layers are the
 * stored gzip bytes verbatim (base64-decoded jsonb).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { Response } from 'superagent';
import { ValheimLinkMessageSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { truncateAllTables } from '../../../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
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

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const SHA = 'a'.repeat(64); // map-shared-layer / map-personal base map
const BASE = '/plugins/valheim/armory/characters';
let testApp: TestApp;
let gameId: number;
let blobDir: string;
let token: string;
const ORIGINAL_BLOB_DIR = process.env.VALHEIM_LINK_BLOB_DIR;
const tempDirs: string[] = [];

type Bitmap = { data: string };
const fixtureBytes = (name: string, key: 'explored' | 'sharedExplored') =>
  Buffer.from(
    (loadValheimFixture(name) as Record<typeof key, Bitmap>)[key].data,
    'base64',
  );
const registry = () => testApp.app.get(PluginRegistryService);
const mapUrl = (id: number | string, mapId: number | string) =>
  `${BASE}/${id}/maps/${mapId}`;

/** Collect the raw response bytes (no superagent body parsing). */
function binary(res: Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
const getBytes = (url: string, headers: Record<string, string> = {}) =>
  testApp.request
    .get(url)
    .set({ Authorization: `Bearer ${token}`, ...headers })
    .buffer(true)
    .parse(binary);

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

/** Import character + map fixtures on a fresh server. */
async function seed(n: number, mapFixture: string) {
  const serverId = await makeServer(n);
  for (const name of ['character-vanilla', mapFixture]) {
    const msg = ValheimLinkMessageSchema.parse(loadValheimFixture(name));
    const row = valheimSnapshotRow(serverId, msg);
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
  return { serverId, id: defined(m.profileId, 'map profile id'), mapId: m.id };
}

/** Register a blob row for `serverId`; writes `bytes` when given. */
async function storeBlob(
  serverId: number,
  storagePath: string,
  bytes?: Buffer,
) {
  if (bytes) {
    await mkdir(dirname(join(blobDir, storagePath)), { recursive: true });
    await writeFile(join(blobDir, storagePath), bytes);
  }
  await testApp.db.insert(schema.valheimLinkBlobs).values({
    pelicanServerId: serverId,
    sha256: SHA,
    byteLength: bytes?.length ?? 10,
    contentType: 'image/png',
    width: 2048,
    height: 2048,
    storagePath,
  });
}

beforeAll(async () => {
  blobDir = await mkdtemp(join(tmpdir(), 'vh-map-bytes-'));
  tempDirs.push(blobDir);
  process.env.VALHEIM_LINK_BLOB_DIR = blobDir;
  testApp = await getTestApp();
});

afterAll(async () => {
  if (ORIGINAL_BLOB_DIR === undefined) delete process.env.VALHEIM_LINK_BLOB_DIR;
  else process.env.VALHEIM_LINK_BLOB_DIR = ORIGINAL_BLOB_DIR;
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
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
  token = await memberToken(testApp, 'alice');
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('GET …/maps/:mapId/base-map (ROK-1837 D3)', () => {
  it('streams the stored PNG, revalidate-only, with the sha ETag', async () => {
    const { serverId, id, mapId } = await seed(1, 'map-shared-layer');
    const png = fakePng(2048, 2048);
    await storeBlob(serverId, blobRelativePath(serverId, SHA), png);
    const res = await getBytes(`${mapUrl(id, mapId)}/base-map`);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, png)).toBe(0);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // The URL is keyed by map id and a re-import can change its PNG, so
    // the browser must revalidate (the sha-keyed blob route is immutable).
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.headers.etag).toBe(`"${SHA}"`);
  });

  it('answers 304 with no body on a matching If-None-Match', async () => {
    const { serverId, id, mapId } = await seed(1, 'map-shared-layer');
    await storeBlob(serverId, blobRelativePath(serverId, SHA), fakePng(8, 8));
    const url = `${mapUrl(id, mapId)}/base-map`;
    const hit = await getBytes(url, { 'If-None-Match': `"${SHA}"` });
    expect(hit.status).toBe(304);
    expect((hit.body as Buffer).length).toBe(0);
    const miss = await getBytes(url, {
      'If-None-Match': `"${'f'.repeat(64)}"`,
    });
    expect(miss.status).toBe(200);
  });

  it('answers a matching If-None-Match with 304 before opening the file', async () => {
    const { serverId, id, mapId } = await seed(1, 'map-shared-layer');
    await storeBlob(serverId, blobRelativePath(serverId, SHA)); // row, no file
    const res = await getBytes(`${mapUrl(id, mapId)}/base-map`, {
      'If-None-Match': `"${SHA}"`,
    });
    expect(res.status).toBe(304);
  });

  it('404s base_map_not_ready (no-store) before the blob is stored', async () => {
    const { id, mapId } = await seed(1, 'map-shared-layer');
    const res = await getBytes(`${mapUrl(id, mapId)}/base-map`);
    expect(res.status).toBe(404);
    expect((res.body as Buffer).toString()).toContain('base_map_not_ready');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET …/maps/:mapId/base-map — scoping (ROK-1837 D3)', () => {
  it("never serves another server's blob with the same sha256", async () => {
    const a = await seed(1, 'map-shared-layer');
    const b = await seed(2, 'map-personal');
    await storeBlob(
      b.serverId,
      blobRelativePath(b.serverId, SHA),
      fakePng(8, 8),
    );
    const res = await getBytes(`${mapUrl(a.id, a.mapId)}/base-map`);
    expect(res.status).toBe(404);
    expect((res.body as Buffer).toString()).toContain('base_map_not_ready');
  });

  it('refuses a storage_path that escapes the blob root (404, no read)', async () => {
    const { serverId, id, mapId } = await seed(1, 'map-shared-layer');
    const outside = await mkdtemp(join(tmpdir(), 'vh-outside-'));
    tempDirs.push(outside);
    await writeFile(join(outside, 'secret.png'), 'SECRET');
    const rel = join('..', outside.split('/').pop() ?? 'x', 'secret.png');
    await storeBlob(serverId, rel);
    const res = await getBytes(`${mapUrl(id, mapId)}/base-map`);
    expect(res.status).toBe(404);
    expect((res.body as Buffer).toString()).not.toContain('SECRET');
  });

  it("404s a map that is not the character's", async () => {
    const a = await seed(1, 'map-shared-layer');
    const b = await seed(2, 'map-shared-layer');
    await storeBlob(
      b.serverId,
      blobRelativePath(b.serverId, SHA),
      fakePng(8, 8),
    );
    expect((await getBytes(`${mapUrl(b.id, b.mapId)}/base-map`)).status).toBe(
      200,
    ); // b's own map serves, so the 404s below are the ownership check
    for (const route of ['base-map', 'fog']) {
      const res = await getBytes(`${mapUrl(a.id, b.mapId)}/${route}`);
      expect({ route, status: res.status }).toEqual({ route, status: 404 });
      expect((res.body as Buffer).toString()).toContain('Map not found');
    }
  });
});

describe('GET …/maps/:mapId/fog (ROK-1837 D4)', () => {
  it('returns the personal layer bytes by default, revalidate-only', async () => {
    const { id, mapId } = await seed(1, 'map-shared-layer');
    const res = await getBytes(`${mapUrl(id, mapId)}/fog`);
    expect(res.status).toBe(200);
    const want = fixtureBytes('map-shared-layer', 'explored');
    expect(Buffer.compare(res.body as Buffer, want)).toBe(0);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers.etag).toMatch(/^"personal-\d+"$/);
    const again = await getBytes(`${mapUrl(id, mapId)}/fog?layer=personal`, {
      'If-None-Match': String(res.headers.etag),
    });
    expect(again.status).toBe(304);
  });

  it('returns the shared layer bytes on layer=shared', async () => {
    const { id, mapId } = await seed(1, 'map-shared-layer');
    const res = await getBytes(`${mapUrl(id, mapId)}/fog?layer=shared`);
    expect(res.status).toBe(200);
    const want = fixtureBytes('map-shared-layer', 'sharedExplored');
    expect(Buffer.compare(res.body as Buffer, want)).toBe(0);
    expect(res.headers.etag).toMatch(/^"shared-\d+"$/);
  });

  it('404s no_shared_layer when the map has no shared layer', async () => {
    const { id, mapId } = await seed(1, 'map-personal');
    const res = await getBytes(`${mapUrl(id, mapId)}/fog?layer=shared`);
    expect(res.status).toBe(404);
    expect((res.body as Buffer).toString()).toContain('no_shared_layer');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('404s no_personal_layer (not no_shared_layer) when the personal layer is missing', async () => {
    const { id, mapId } = await seed(1, 'map-shared-layer');
    const M = schema.valheimMaps;
    await testApp.db
      .update(M)
      .set({ explored: sql`'null'::jsonb` })
      .where(eq(M.id, mapId));
    const res = await getBytes(`${mapUrl(id, mapId)}/fog?layer=personal`);
    expect(res.status).toBe(404);
    expect((res.body as Buffer).toString()).toContain('no_personal_layer');
  });

  it('400s an unknown layer (no-store)', async () => {
    const { id, mapId } = await seed(1, 'map-shared-layer');
    const res = await getBytes(`${mapUrl(id, mapId)}/fog?layer=bogus`);
    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('map byte routes — ids, auth, plugin', () => {
  const routes = (id: number | string, mapId: number | string) => [
    `${mapUrl(id, mapId)}/base-map`,
    `${mapUrl(id, mapId)}/fog`,
  ];

  it('400s non-positive or non-integer ids', async () => {
    for (const [id, mapId] of [
      ['0', '1'],
      ['1', '-2'],
      ['abc', '1'],
      ['1', '1.5'],
    ]) {
      for (const url of routes(id ?? '', mapId ?? '')) {
        expect({ url, status: (await getBytes(url)).status }).toEqual({
          url,
          status: 400,
        });
      }
    }
  });

  it('401s both routes when signed out', async () => {
    const { id, mapId } = await seed(1, 'map-shared-layer');
    for (const url of routes(id, mapId)) {
      expect((await testApp.request.get(url)).status).toBe(401);
    }
  });

  it('403s both routes while the Valheim plugin is inactive', async () => {
    const { id, mapId } = await seed(1, 'map-shared-layer');
    await registry().deactivate(VALHEIM_PLUGIN_ID);
    for (const url of routes(id, mapId)) {
      expect((await getBytes(url)).status).toBe(403);
    }
  });
});
