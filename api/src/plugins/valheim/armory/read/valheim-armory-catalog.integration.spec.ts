/**
 * ROK-1836 L1 — the character detail's catalogue subset (D4) and the
 * member blob route (D5), against a real database. The detail carries ONLY
 * the prefabs the sheet references, file icons expose a sha256 and never
 * the mod's file name, and blob bytes are located by `(server, sha256)` →
 * `storage_path` alone — never by a name or a sha-derived path.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Response } from 'superagent';
import { ValheimCharacterDetailSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { truncateAllTables } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { SettingsService } from '../../../../settings/settings.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { memberToken } from '../../../pelican/testing/pelican-integration.helpers';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { blobRelativePath } from '../../link/blobs/valheim-link-blob.store';
import { fakePng, sha256Of } from '../../link/blobs/valheim-link-blob.testing';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from '../valheim-armory-import.service';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const ATLAS_SHA = 'b'.repeat(64); // items-atlas fixture
const FILE_SHA = 'c'.repeat(64); // items-file-icons fixture (SwordIron)
const REFERENCED = [
  'CookedMeat',
  'HelmetBronze',
  'SwordIron',
  'TrophyBoar',
  'TrophyEikthyr',
  'Wood',
]; // character-vanilla: equipment + inventory + trophies
let testApp: TestApp;
let gameId: number;
let blobDir: string;
let token: string;

const registry = () => testApp.app.get(PluginRegistryService);
const auth = () => ({ Authorization: `Bearer ${token}` });
const blobUrl = (serverId: number | string, sha: string) =>
  `/plugins/valheim/armory/servers/${serverId}/blobs/${sha}`;

/** Collect the raw response bytes (no superagent body parsing). */
function binary(res: Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
const getBlob = (url: string) =>
  testApp.request.get(url).set(auth()).buffer(true).parse(binary);

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

/** Import contract fixtures on a fresh server; returns its profile id. */
async function seed(n: number, ...fixtures: string[]) {
  const serverId = await makeServer(n);
  for (const name of fixtures) {
    const row = valheimSnapshotRow(serverId, loadValheimFixture(name) as never);
    await testApp.db.insert(schema.valheimLinkSnapshots).values(row);
  }
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
  const P = schema.valheimProfiles;
  const [p] = nonEmpty(
    await testApp.db
      .select({ id: P.id })
      .from(P)
      .where(eq(P.pelicanServerId, serverId)),
    'profile',
  );
  return { serverId, id: p.id };
}

async function detail(id: number) {
  const res = await testApp.request
    .get(`/plugins/valheim/armory/characters/${id}`)
    .set(auth());
  expect(res.status).toBe(200);
  return {
    raw: JSON.stringify(res.body),
    body: ValheimCharacterDetailSchema.parse(res.body),
  };
}

/** Store `bytes` at `storagePath` and register the blob row for the server. */
async function storeBlob(serverId: number, bytes: Buffer, storagePath: string) {
  const sha256 = sha256Of(bytes);
  await mkdir(dirname(join(blobDir, storagePath)), { recursive: true });
  await writeFile(join(blobDir, storagePath), bytes);
  await testApp.db.insert(schema.valheimLinkBlobs).values({
    pelicanServerId: serverId,
    sha256,
    byteLength: bytes.length,
    contentType: 'image/png',
    width: 8,
    height: 8,
    storagePath,
  });
  return sha256;
}

beforeAll(async () => {
  blobDir = await mkdtemp(join(tmpdir(), 'vh-armory-blobs-'));
  process.env.VALHEIM_LINK_BLOB_DIR = blobDir;
  testApp = await getTestApp();
});

afterAll(() => {
  delete process.env.VALHEIM_LINK_BLOB_DIR;
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

describe('Valheim character detail catalogue subset (ROK-1836 D4)', () => {
  it('carries only the catalogue entries the sheet references', async () => {
    const { id } = await seed(1, 'character-vanilla', 'items-atlas');
    const catalogue = (
      loadValheimFixture('items-atlas') as {
        items: { prefab: string }[];
      }
    ).items.map((i) => i.prefab);
    const unreferenced = catalogue.filter((p) => !REFERENCED.includes(p));
    expect(unreferenced.length).toBeGreaterThan(0);
    const { body } = await detail(id);
    const expected = catalogue.filter((p) => REFERENCED.includes(p)).sort();
    expect(Object.keys(body.items ?? {}).sort()).toEqual(expected);
    expect(body.items?.SwordIron).toEqual({
      name: 'Iron sword',
      category: 'OneHandedWeapon',
      icon: { kind: 'atlas', x: 0, y: 0, w: 64, h: 64 },
    });
    expect(body.atlas).toEqual({
      sha256: ATLAS_SHA,
      width: 1024,
      height: 1024,
      ready: false,
    });
  });

  it('flips atlas.ready once the atlas blob row exists', async () => {
    const { id, serverId } = await seed(2, 'character-vanilla', 'items-atlas');
    await testApp.db.insert(schema.valheimLinkBlobs).values({
      pelicanServerId: serverId,
      sha256: ATLAS_SHA,
      byteLength: 10,
      contentType: 'image/png',
      width: 1024,
      height: 1024,
      storagePath: blobRelativePath(serverId, ATLAS_SHA),
    });
    expect((await detail(id)).body.atlas?.ready).toBe(true);
  });

  it('maps a file icon to its sha256 and never exposes the file name', async () => {
    const { id } = await seed(3, 'character-vanilla', 'items-file-icons');
    const { body, raw } = await detail(id);
    expect(body.items?.SwordIron?.icon).toEqual({
      kind: 'file',
      sha256: FILE_SHA,
    });
    expect(raw).not.toContain('SwordIron.png');
    expect(body.atlas).toBeNull();
  });

  it('returns items {} and atlas null when no catalogue exists', async () => {
    const { id } = await seed(4, 'character-vanilla');
    const { body } = await detail(id);
    expect(body.items).toEqual({});
    expect(body.atlas).toBeNull();
  });

  it('ignores another server’s catalogue for the same game version', async () => {
    const { id } = await seed(5, 'character-vanilla');
    await seed(6, 'character-vanilla', 'items-atlas');
    expect((await detail(id)).body.items).toEqual({});
  });
});

describe('GET plugins/valheim/armory/servers/:serverId/blobs/:sha256 (D5)', () => {
  it('streams the stored PNG with fixed headers', async () => {
    const serverId = await makeServer(10);
    const bytes = fakePng(8, 8, 64);
    const sha = await storeBlob(serverId, bytes, `${serverId}/opaque-name.bin`);
    const res = await getBlob(blobUrl(serverId, sha));
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, bytes)).toBe(0);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe(
      'private, max-age=31536000, immutable',
    );
  });

  it('never derives the path from a name: an unregistered file at the conventional path is 404', async () => {
    const serverId = await makeServer(11);
    const bytes = fakePng(8, 8, 32);
    const sha = sha256Of(bytes);
    const conventional = join(blobDir, blobRelativePath(serverId, sha));
    await mkdir(dirname(conventional), { recursive: true });
    await writeFile(conventional, bytes);
    expect((await getBlob(blobUrl(serverId, sha))).status).toBe(404);
  });

  it('404s for an unknown sha, a row whose file is gone, and another server’s blob', async () => {
    const a = await makeServer(12);
    const b = await makeServer(13);
    const sha = await storeBlob(a, fakePng(8, 8, 8), `${a}/kept.png`);
    const gone = sha256Of(fakePng(8, 8, 9));
    await testApp.db.insert(schema.valheimLinkBlobs).values({
      pelicanServerId: a,
      sha256: gone,
      byteLength: 9,
      contentType: 'image/png',
      width: 8,
      height: 8,
      storagePath: `${a}/never-written.png`,
    });
    const statuses = [];
    for (const url of [
      blobUrl(a, 'd'.repeat(64)),
      blobUrl(a, gone),
      blobUrl(b, sha),
    ]) {
      statuses.push((await getBlob(url)).status);
    }
    expect(statuses).toEqual([404, 404, 404]);
  });

  it('400s on a malformed sha256 or server id', async () => {
    const statuses = [];
    for (const url of [
      blobUrl(1, 'A'.repeat(64)),
      blobUrl(1, 'abc'),
      blobUrl(1, `${'a'.repeat(63)}.`),
      blobUrl(0, 'a'.repeat(64)),
    ]) {
      statuses.push((await getBlob(url)).status);
    }
    expect(statuses).toEqual([400, 400, 400, 400]);
  });

  it('401s without a JWT', async () => {
    const res = await testApp.request.get(blobUrl(1, 'a'.repeat(64)));
    expect(res.status).toBe(401);
  });
});

describe('blob error responses are never cached (ROK-1836 M1)', () => {
  it('a not-ready 404 is no-store, never the immutable blob policy', async () => {
    const serverId = await makeServer(14);
    const res = await getBlob(blobUrl(serverId, 'e'.repeat(64)));
    expect(res.status).toBe(404);
    expect(`${res.headers['cache-control']}`).not.toContain('immutable');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('a malformed-sha 400 is no-store', async () => {
    const res = await getBlob(blobUrl(1, 'abc'));
    expect(res.status).toBe(400);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
