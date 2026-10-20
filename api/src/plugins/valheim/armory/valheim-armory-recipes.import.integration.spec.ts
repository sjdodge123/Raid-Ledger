/**
 * ROK-1854 L2 §2.6 I1–I6 — `recipes` messages through the real ingest route
 * (`POST /plugins/valheim/link/messages/recipes`, token, gzip) and the
 * importer (`drainOnce`) into the six recipe tables; latest wins per
 * (server, gameVersion) and reads serve the newest `captured_at` (D6).
 */
import { count, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { gzipSync } from 'node:zlib';
import {
  VALHEIM_LINK_RECIPES_MAX,
  VALHEIM_LINK_RECIPES_MAX_BYTES,
  ValheimLinkMessageSchema,
  ValheimLinkTokenIssuedSchema,
  ValheimRecipeCatalogResponseSchema,
} from '@raid-ledger/contract';
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
import { fakeServer } from '../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from './valheim-armory-import.service';
import { ensureFixtureHubId } from './valheim-armory-map-hub.helpers';
import { largestRecipesMessage } from './valheim-recipes.testing';

const ROUTE = '/plugins/valheim/link/messages/recipes';
const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const T0 = '2026-10-17T20:15:00Z';
const T1 = '2026-10-17T21:00:00Z';
const T2 = '2026-10-17T22:00:00Z';
const ATLAS_SHA = 'd'.repeat(64);
const S = schema.valheimLinkSnapshots;
const SETS = schema.valheimRecipeSets;

let testApp: TestApp;
let admin: string;
let server: number;
let token: string;
type Msg = Record<string, unknown>;
const registry = () => testApp.app.get(PluginRegistryService);
const drain = () => testApp.app.get(ValheimArmoryImportService).drainOnce();

async function makeServer(): Promise<number> {
  const [game] = nonEmpty(
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
        gameId: game.id,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  await ensureFixtureHubId(testApp.db, row.id, game.id);
  return row.id;
}

async function issueToken(serverId: number): Promise<string> {
  const res = await testApp.request
    .post(`/admin/plugins/valheim/link-tokens/${serverId}`)
    .set({ Authorization: `Bearer ${admin}` })
    .send({});
  return ValheimLinkTokenIssuedSchema.parse(res.body).token;
}

/** Bytes on the wire as-is (superagent would JSON-wrap a Buffer). */
function post(body: Buffer, gzip = false) {
  const r = testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .serialize((bytes) => bytes);
  return (gzip ? r.set('Content-Encoding', 'gzip') : r).send(body);
}
const json = (o: unknown): Buffer => Buffer.from(JSON.stringify(o));

/** A fixture re-pointed at the test server. */
function fixture(name: string, over: Msg = {}): Msg {
  return {
    ...loadValheimFixture(name),
    serverId: String(server),
    ...over,
  };
}

/** Store a message as ingest does (replacing the key) without the route. */
async function pushDirect(msg: Msg): Promise<void> {
  const row = valheimSnapshotRow(server, ValheimLinkMessageSchema.parse(msg));
  await testApp.db
    .insert(S)
    .values(row)
    .onConflictDoUpdate({
      target: [S.pelicanServerId, S.kind, S.snapshotKey],
      set: {
        capturedAt: row.capturedAt,
        payload: row.payload,
        status: 'pending',
      },
    });
}

async function counts() {
  const n = async (t: PgTable) =>
    nonEmpty(await testApp.db.select({ c: count() }).from(t), 'count')[0].c;
  return {
    sets: await n(SETS),
    stations: await n(schema.valheimRecipeStations),
    recipes: await n(schema.valheimRecipes),
    pieces: await n(schema.valheimPieces),
    processors: await n(schema.valheimProcessors),
    processes: await n(schema.valheimProcesses),
  };
}

const recipeIds = async () =>
  (await testApp.db.select().from(schema.valheimRecipes))
    .map((r) => r.recipeId)
    .sort();

async function catalogue() {
  const res = await testApp.request
    .get(`/plugins/valheim/armory/servers/${server}/recipes`)
    .set({ Authorization: `Bearer ${admin}` });
  expect(res.status).toBe(200);
  return ValheimRecipeCatalogResponseSchema.parse(res.body);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  for (const slug of PLUGINS) {
    await registry().ensureInstalled(slug);
    await registry().activate(slug);
  }
  admin = await loginAsAdmin(testApp.request, testApp.seed);
  server = await makeServer();
  token = await issueToken(server);
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('recipes ingest → importer (I1–I4)', () => {
  it('I1 vanilla fixture: 202, rows in all six tables', async () => {
    const res = await post(json(fixture('recipes-vanilla')));
    expect({ status: res.status, body: res.body as unknown }).toEqual({
      status: 202,
      body: { status: 'accepted', missingBlobs: [] },
    });
    expect((await drain()).imported).toBe(1);
    expect(await counts()).toEqual({
      sets: 1,
      stations: 2,
      recipes: 2,
      pieces: 1,
      processors: 1,
      processes: 1,
    });
    const [set] = nonEmpty(await testApp.db.select().from(SETS), 'set');
    expect(set).toMatchObject({
      pelicanServerId: server,
      gameVersion: '0.220.5',
      locale: 'English',
      atlasSha256: null,
    });
    expect(set.capturedAt.toISOString()).toBe('2026-10-17T20:15:00.000Z');
    expect(await recipeIds()).toEqual(['Recipe_Club', 'Recipe_SwordIron']);
  });

  it('I1 atlas sha is in missingBlobs until the blob is stored', async () => {
    const first = await post(json(fixture('recipes-processing')));
    expect(first.status).toBe(202);
    expect(first.body).toEqual({
      status: 'accepted',
      missingBlobs: [ATLAS_SHA],
    });
    expect((await drain()).imported).toBe(1);
    const [set] = nonEmpty(await testApp.db.select().from(SETS), 'set');
    expect(set.atlasSha256).toBe(ATLAS_SHA);
    expect((await catalogue()).recipeAtlas).toEqual({
      sha256: ATLAS_SHA,
      width: 256,
      height: 256,
      ready: false,
    });
    await testApp.db.insert(schema.valheimLinkBlobs).values({
      pelicanServerId: server,
      sha256: ATLAS_SHA,
      byteLength: 65536,
      contentType: 'image/png',
      width: 256,
      height: 256,
      storagePath: `${server}/${ATLAS_SHA}.png`,
    });
    const again = await post(
      json(fixture('recipes-processing', { capturedAt: T1 })),
    );
    expect(again.body).toEqual({ status: 'accepted', missingBlobs: [] });
    expect((await catalogue()).recipeAtlas?.ready).toBe(true);
  });

  it('I2 older capturedAt, same gameVersion: stale at ingest, skipped_stale at import', async () => {
    await post(json(fixture('recipes-vanilla', { capturedAt: T1 })));
    await drain();
    const before = await counts();
    const res = await post(
      json(fixture('recipes-vanilla', { capturedAt: T0 })),
    );
    expect(res.body).toEqual({ status: 'stale', missingBlobs: [] });
    // The importer's own guard: an older payload that reaches the queue.
    const older = fixture('recipes-vanilla', { capturedAt: T0, recipes: [] });
    await pushDirect(older);
    expect((await drain()).skipped_stale).toBe(1);
    expect(await counts()).toEqual(before);
    const [set] = nonEmpty(await testApp.db.select().from(SETS), 'set');
    expect(set.capturedAt.toISOString()).toBe('2026-10-17T21:00:00.000Z');
  });

  it('I3 a newer capture without Recipe_Club removes its row (children replaced)', async () => {
    const f = fixture('recipes-vanilla');
    await post(json(f));
    await drain();
    const [before] = nonEmpty(await testApp.db.select().from(SETS), 'set');
    const kept = (f['recipes'] as Msg[]).filter(
      (r) => r['id'] !== 'Recipe_Club',
    );
    await post(json({ ...f, capturedAt: T1, recipes: kept }));
    expect((await drain()).imported).toBe(1);
    expect(await recipeIds()).toEqual(['Recipe_SwordIron']);
    const [after] = nonEmpty(await testApp.db.select().from(SETS), 'set');
    expect(after.id).toBe(before.id);
    expect(after.capturedAt.toISOString()).toBe('2026-10-17T21:00:00.000Z');
  });

  it('I4 a second gameVersion is a second set; reads serve the newest captured_at', async () => {
    await post(json(fixture('recipes-vanilla', { capturedAt: T1 })));
    await drain();
    // Higher version, OLDER capture: must not win (D6 is by captured_at).
    await post(
      json(
        fixture('recipes-vanilla', { gameVersion: '0.221.0', capturedAt: T0 }),
      ),
    );
    await drain();
    expect((await testApp.db.select().from(SETS)).length).toBe(2);
    expect((await catalogue()).gameVersion).toBe('0.220.5');
    await post(
      json(
        fixture('recipes-vanilla', { gameVersion: '0.221.0', capturedAt: T2 }),
      ),
    );
    await drain();
    const versions = (await testApp.db.select().from(SETS))
      .map((s) => s.gameVersion)
      .sort();
    expect(versions).toEqual(['0.220.5', '0.221.0']);
    const cat = await catalogue();
    expect({ v: cat.gameVersion, at: cat.capturedAt }).toEqual({
      v: '0.221.0',
      at: '2026-10-17T22:00:00.000Z',
    });
  });
});

describe('recipes body limits (I5/I6)', () => {
  it('I5 the largest schema-valid message (gzipped) is accepted and imports', async () => {
    const msg = largestRecipesMessage(String(server), T0);
    const raw = json(msg);
    expect(raw.length).toBeLessThanOrEqual(VALHEIM_LINK_RECIPES_MAX_BYTES);
    const res = await post(gzipSync(raw), true);
    expect({ status: res.status, body: res.body as unknown }).toEqual({
      status: 202,
      body: { status: 'accepted', missingBlobs: ['f'.repeat(64)] },
    });
    expect((await drain()).imported).toBe(1);
    const c = await counts();
    expect(c).toMatchObject({ sets: 1, recipes: VALHEIM_LINK_RECIPES_MAX });
    expect(c.processes).toBe(msg.processes.length);
    expect(c.pieces).toBe(msg.pieces.length);
  });

  it(`I6 a body over VALHEIM_LINK_RECIPES_MAX_BYTES decoded is 413 payload_too_large`, async () => {
    const pad = 'x'.repeat(VALHEIM_LINK_RECIPES_MAX_BYTES + 1);
    const res = await post(gzipSync(json({ pad })), true);
    expect({ status: res.status, body: res.body as unknown }).toMatchObject({
      status: 413,
      body: { code: 'payload_too_large' },
    });
    const rows = await testApp.db.select().from(S).where(eq(S.kind, 'recipes'));
    expect(rows).toEqual([]);
  });
});
