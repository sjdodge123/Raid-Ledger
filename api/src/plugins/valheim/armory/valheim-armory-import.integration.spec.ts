/**
 * ROK-1835 L2 — the armory importer against a real database: pending
 * snapshots (golden fixtures, inserted as ingest stores them) drained with
 * `drainOnce()` into profiles / maps / item catalogues.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { fakeServer } from '../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG } from '../valheim.constants';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../link/ingest/valheim-link-snapshot.helpers';
import {
  ValheimArmoryImportService,
  type ArmoryDrainSummary,
} from './valheim-armory-import.service';
import { ValheimArmoryRepository } from './valheim-armory.repository';

let testApp: TestApp;
let server: number;
const S = schema.valheimLinkSnapshots;
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
  return row.id;
}

/** Insert (or replace, as ingest does) a pending snapshot for a fixture. */
async function push(
  name: string,
  edit: Record<string, unknown> = {},
): Promise<number> {
  const msg = { ...loadValheimFixture(name), ...edit };
  const row = valheimSnapshotRow(server, msg as never);
  const [s] = nonEmpty(
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
      })
      .returning({ id: S.id }),
    'snapshot',
  );
  return s.id;
}

async function statusOf(
  id: number,
): Promise<{ status: string; statusDetail: string | null }> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ status: S.status, statusDetail: S.statusDetail })
      .from(S)
      .where(eq(S.id, id)),
    'snapshot row',
  );
  return row;
}

/** Rewrite the stored snapshot as ingest's replace does (bumps received_at). */
async function replaceSnapshot(
  id: number,
  capturedAt: string,
  bumpMs: number,
): Promise<void> {
  await testApp.db
    .update(S)
    .set({
      payload: { ...loadValheimFixture('character-vanilla'), capturedAt },
      capturedAt: new Date(capturedAt),
      receivedAt: new Date(Date.now() + bumpMs),
      status: 'pending',
    })
    .where(eq(S.id, id));
}

/** Rows a drain finished (anything but `busy`). */
const done = (s: ArmoryDrainSummary): number =>
  s.imported + s.failed + s.skipped_stale + s.waiting_blob;

const profiles = () => testApp.db.select().from(schema.valheimProfiles);
const mapsRows = () => testApp.db.select().from(schema.valheimMaps);

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  server = await makeServer();
});

describe('Valheim armory importer (integration)', () => {
  it('imports a character into one profile and marks the snapshot imported', async () => {
    const id = await push('character-vanilla');
    expect((await drain()).imported).toBe(1);
    const [p] = nonEmpty(await profiles(), 'profile');
    expect(p).toMatchObject({
      pelicanServerId: server,
      name: 'Testviking',
      claimedBy: null,
    });
    expect(await statusOf(id)).toEqual({
      status: 'imported',
      statusDetail: null,
    });
  });

  it('replaces the profile with a newer snapshot and skips an older one', async () => {
    await push('character-vanilla');
    await drain();
    await push('character-vanilla', { capturedAt: '2026-10-17T21:00:00Z' });
    await drain();
    const rows = await profiles();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.capturedAt.toISOString()).toBe('2026-10-17T21:00:00.000Z');
    await testApp.db
      .update(S)
      .set({ capturedAt: new Date('2026-10-17T19:00:00Z'), status: 'pending' });
    await testApp.db.update(S).set({
      payload: {
        ...loadValheimFixture('character-vanilla'),
        capturedAt: '2026-10-17T19:00:00Z',
      },
    });
    const [snap] = nonEmpty(
      await testApp.db.select({ id: S.id }).from(S),
      'snap',
    );
    expect((await drain()).skipped_stale).toBe(1);
    expect((await statusOf(snap.id)).status).toBe('skipped_stale');
    expect((await profiles())[0]?.capturedAt.toISOString()).toBe(
      '2026-10-17T21:00:00.000Z',
    );
  });

  it('fails an invalid payload and leaves the existing profile untouched', async () => {
    await push('character-vanilla');
    await drain();
    const before = await profiles();
    await testApp.db.update(S).set({
      status: 'pending',
      payload: {
        ...loadValheimFixture('character-vanilla'),
        equipment: 'nope',
        capturedAt: '2026-10-18T00:00:00Z',
      },
    });
    expect((await drain()).failed).toBe(1);
    const [snap] = nonEmpty(
      await testApp.db.select({ status: S.status, d: S.statusDetail }).from(S),
      'snap',
    );
    expect(snap.status).toBe('failed');
    expect(snap.d).toMatch(/^invalid:equipment:/);
    expect(await profiles()).toEqual(before);
  });

  it('stores a map without its base-map blob as waiting_blob, then imports once it lands', async () => {
    const id = await push('map-shared-layer');
    expect((await drain()).waiting_blob).toBe(1);
    const [m] = nonEmpty(await mapsRows(), 'map');
    expect(m.profileId).toBeNull();
    expect(m.baseMapSha256).toBe('a'.repeat(64));
    expect((await drain()).waiting_blob).toBe(0);
    await testApp.db.insert(schema.valheimLinkBlobs).values({
      pelicanServerId: server,
      sha256: 'a'.repeat(64),
      byteLength: 3145728,
      contentType: 'image/png',
      width: m.textureSize,
      height: m.textureSize,
      storagePath: 'x/aa.png',
    });
    expect((await drain()).imported).toBe(1);
    expect((await statusOf(id)).status).toBe('imported');
    expect(await mapsRows()).toHaveLength(1);
  });

  it('back-fills a map that arrived before its character', async () => {
    await push('map-personal');
    await push('character-vanilla');
    await drain();
    const [p] = nonEmpty(await profiles(), 'profile');
    const [m] = nonEmpty(await mapsRows(), 'map');
    expect(m.profileId).toBe(p.id);
  });

  it('imports an items export into a prefab-keyed catalogue', async () => {
    await push('items-file-icons');
    await drain();
    const [c] = nonEmpty(
      await testApp.db.select().from(schema.valheimItemCatalogs),
      'catalog',
    );
    expect(c).toMatchObject({
      pelicanServerId: server,
      gameVersion: '0.220.5',
    });
    expect(c.items['SwordIron']?.icon).toEqual({
      kind: 'file',
      file: 'SwordIron.png',
      sha256: 'c'.repeat(64),
    });
  });

  it('a snapshot replaced mid-import stays pending; the newer wins and an older replay is skipped_stale (T4)', async () => {
    const id = await push('character-vanilla', {
      capturedAt: '2026-10-17T20:00:00Z',
    });
    const repo = testApp.app.get(ValheimArmoryRepository);
    const real = repo.listCandidates.bind(repo);
    const spy = jest
      .spyOn(repo, 'listCandidates')
      .mockImplementationOnce(async (limit: number) => {
        const listed = await real(limit);
        await replaceSnapshot(id, '2026-10-17T21:00:00Z', 60_000);
        return listed;
      });
    try {
      expect((await drain()).busy).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect((await statusOf(id)).status).toBe('pending');
    expect(await profiles()).toHaveLength(0);
    expect((await drain()).imported).toBe(1);
    const newer = '2026-10-17T21:00:00.000Z';
    expect((await profiles())[0]?.capturedAt.toISOString()).toBe(newer);
    await replaceSnapshot(id, '2026-10-17T20:00:00Z', 120_000);
    expect((await drain()).skipped_stale).toBe(1);
    expect((await statusOf(id)).status).toBe('skipped_stale');
    expect((await profiles())[0]?.capturedAt.toISOString()).toBe(newer);
  });

  it('two concurrent drains process each snapshot exactly once (SKIP LOCKED)', async () => {
    const [u] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'local:steamy',
          username: 'steamy',
          role: 'member',
          steamId: '76561198000000001',
        })
        .returning({ id: schema.users.id }),
      'user',
    );
    const ids = [
      await push('character-vanilla'),
      await push('items-file-icons'),
    ];
    const [a, b] = await Promise.all([drain(), drain()]);
    expect(done(a) + done(b)).toBe(ids.length);
    expect(a.failed + b.failed).toBe(0);
    for (const id of ids) expect((await statusOf(id)).status).toBe('imported');
    const [p] = nonEmpty(await profiles(), 'profile');
    expect(await profiles()).toHaveLength(1);
    expect(p.claimedBy).toBe(u.id);
    const E = schema.valheimProfileClaimEvents;
    const attaches = await testApp.db
      .select()
      .from(E)
      .where(eq(E.action, 'auto_attach'));
    expect(attaches).toHaveLength(1);
    expect(
      await testApp.db.select().from(schema.valheimItemCatalogs),
    ).toHaveLength(1);
  });
});
