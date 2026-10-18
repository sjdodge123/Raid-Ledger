/**
 * ROK-1833 — Valheim Link blob upload against a real database + a tmpdir
 * blob root: either order with the referencing message, hash mismatch,
 * forged-IHDR rejection from the header alone, idempotent re-upload,
 * per-server scoping and the non-Valheim 403.
 */
import { and, eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ValheimLinkBlobResultSchema,
  ValheimLinkIngestResultSchema,
  ValheimLinkTokenIssuedSchema,
} from '@raid-ledger/contract';
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
import { loadValheimFixture } from '../ingest/valheim-link-ingest.testing';
import { fakePng, sha256Of } from './valheim-link-blob.testing';
import { pngHeader } from './valheim-link-png.helpers';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
/** `map-shared-layer` grid.textureSize — the base map must be that square. */
const EDGE = 2048;
let testApp: TestApp;
let adminToken: string;
let blobDir: string;
const registry = () => testApp.app.get(PluginRegistryService);

async function valheimServer(n: number): Promise<number> {
  const [game] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, VALHEIM_GAME_SLUG));
  const gameId =
    game?.id ??
    nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
        .returning({ id: schema.games.id }),
      'valheim game',
    )[0].id;
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
    `pelican server ${n}`,
  );
  return row.id;
}

async function issueToken(serverId: number): Promise<string> {
  const res = await testApp.request
    .post(`/admin/plugins/valheim/link-tokens/${serverId}`)
    .set({ Authorization: `Bearer ${adminToken}` })
    .send({});
  return ValheimLinkTokenIssuedSchema.parse(res.body).token;
}

const put = (token: string, sha: string, body: Buffer) =>
  testApp.request
    .put(`/plugins/valheim/link/blobs/${sha}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'image/png')
    .send(body);

const recent = (minutesAgo: number): string =>
  new Date(Date.now() - minutesAgo * 60_000)
    .toISOString()
    .replace(/\.\d+Z$/, 'Z');

/** A map message whose base map is `png` (EDGE² = the fixture's textureSize). */
function postMap(token: string, serverId: number, png: Buffer, ago: number) {
  const msg = {
    ...loadValheimFixture('map-shared-layer'),
    serverId: String(serverId),
    capturedAt: recent(ago),
    baseMap: {
      sha256: sha256Of(png),
      byteLength: png.length,
      contentType: 'image/png',
      width: EDGE,
      height: EDGE,
    },
  };
  return (
    testApp.request
      .post('/plugins/valheim/link/messages/map')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      // superagent would JSON-serialise the Buffer itself; send the bytes as-is.
      .serialize((bytes) => bytes)
      .send(Buffer.from(JSON.stringify(msg)))
  );
}

async function blobRow(serverId: number, sha: string) {
  const [row] = await testApp.db
    .select()
    .from(schema.valheimLinkBlobs)
    .where(
      and(
        eq(schema.valheimLinkBlobs.pelicanServerId, serverId),
        eq(schema.valheimLinkBlobs.sha256, sha),
      ),
    );
  return row;
}

const missing = (res: { body: unknown }): string[] =>
  ValheimLinkIngestResultSchema.parse(res.body).missingBlobs;

beforeAll(async () => {
  blobDir = await mkdtemp(join(tmpdir(), 'vl-blobs-int-'));
  process.env.VALHEIM_LINK_BLOB_DIR = blobDir;
  testApp = await getTestApp();
});

afterAll(() => {
  delete process.env.VALHEIM_LINK_BLOB_DIR;
});

beforeEach(async () => {
  for (const slug of PLUGINS) {
    await registry().ensureInstalled(slug);
    await registry().activate(slug);
  }
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('Valheim Link blob upload (ROK-1833)', () => {
  it('message first, then blob: 201 stored, file on disk, ref resolved', async () => {
    const id = await valheimServer(1);
    const token = await issueToken(id);
    const png = fakePng(EDGE, EDGE);
    const sha = sha256Of(png);
    expect(missing(await postMap(token, id, png, 10))).toEqual([sha]);
    const res = await put(token, sha, png);
    expect(res.status).toBe(201);
    expect(ValheimLinkBlobResultSchema.parse(res.body)).toEqual({
      status: 'stored',
      sha256: sha,
    });
    const row = await blobRow(id, sha);
    expect(row).toMatchObject({
      byteLength: png.length,
      width: EDGE,
      height: EDGE,
    });
    expect(row?.lastReferencedAt).not.toBeNull();
    expect(existsSync(join(blobDir, String(id), `${sha}.png`))).toBe(true);
    expect(missing(await postMap(token, id, png, 5))).toEqual([]);
  });

  it('blob first, then message: missingBlobs is empty; re-upload is 200 exists', async () => {
    const id = await valheimServer(1);
    const token = await issueToken(id);
    const png = fakePng(EDGE, EDGE);
    expect((await put(token, sha256Of(png), png)).status).toBe(201);
    expect(missing(await postMap(token, id, png, 10))).toEqual([]);
    const again = await put(token, sha256Of(png), png);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ status: 'exists', sha256: sha256Of(png) });
  });

  it('a body whose sha differs from the path is 400 hash_mismatch and not stored', async () => {
    const id = await valheimServer(1);
    const token = await issueToken(id);
    const wrong = 'e'.repeat(64);
    const res = await put(token, wrong, fakePng(EDGE, EDGE));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'hash_mismatch' });
    expect(await blobRow(id, wrong)).toBeUndefined();
  });

  it('a forged 20000×20000 IHDR is 400 png_too_large from the header alone', async () => {
    const id = await valheimServer(1);
    const token = await issueToken(id);
    const forged = pngHeader(20_000, 20_000);
    const res = await put(token, sha256Of(forged), forged);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'png_too_large' });
    expect(res.headers['connection']).toBe('close');
  });

  it('blobs are per server: server A’s upload does not resolve server B’s ref', async () => {
    const a = await valheimServer(1);
    const b = await valheimServer(2);
    const [tokenA, tokenB] = [await issueToken(a), await issueToken(b)];
    const png = fakePng(EDGE, EDGE);
    expect((await put(tokenA, sha256Of(png), png)).status).toBe(201);
    expect(missing(await postMap(tokenB, b, png, 10))).toEqual([sha256Of(png)]);
  });

  it('a token whose server is no longer mapped to Valheim is 403', async () => {
    const id = await valheimServer(1);
    const token = await issueToken(id);
    await testApp.db
      .update(schema.pelicanServers)
      .set({ gameId: null })
      .where(eq(schema.pelicanServers.id, id));
    const png = fakePng(EDGE, EDGE);
    const res = await put(token, sha256Of(png), png);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'server_not_valheim' });
  });
});

describe('Valheim Link blob quota (ROK-1833)', () => {
  afterEach(() => {
    delete process.env.VALHEIM_LINK_MAX_BLOBS_PER_SERVER;
  });

  it('413 quota_exceeded past the per-server blob count; other servers unaffected', async () => {
    process.env.VALHEIM_LINK_MAX_BLOBS_PER_SERVER = '1';
    const a = await valheimServer(1);
    const b = await valheimServer(2);
    const [tokenA, tokenB] = [await issueToken(a), await issueToken(b)];
    const first = fakePng(4, 4);
    const second = fakePng(8, 8);
    expect((await put(tokenA, sha256Of(first), first)).status).toBe(201);
    const over = await put(tokenA, sha256Of(second), second);
    expect(over.status).toBe(413);
    expect(over.body).toMatchObject({ code: 'quota_exceeded' });
    expect(await blobRow(a, sha256Of(second))).toBeUndefined();
    expect((await put(tokenB, sha256Of(second), second)).status).toBe(201);
  });

  it('two concurrent uploads where only one fits: exactly one is stored', async () => {
    const a = await valheimServer(1);
    const token = await issueToken(a);
    const first = fakePng(4, 4);
    const second = fakePng(4, 5);
    process.env.VALHEIM_LINK_MAX_BLOB_BYTES_PER_SERVER = String(
      Math.max(first.length, second.length),
    );
    try {
      const res = await Promise.all([
        put(token, sha256Of(first), first),
        put(token, sha256Of(second), second),
      ]);
      expect(res.map((r) => r.status).sort()).toEqual([201, 413]);
      const stored = await testApp.db
        .select()
        .from(schema.valheimLinkBlobs)
        .where(eq(schema.valheimLinkBlobs.pelicanServerId, a));
      expect(stored).toHaveLength(1);
    } finally {
      delete process.env.VALHEIM_LINK_MAX_BLOB_BYTES_PER_SERVER;
    }
  });
});
