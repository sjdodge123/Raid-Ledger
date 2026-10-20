/**
 * ROK-1853 L2 — the containers importer against a real database: pending
 * `containers` snapshots (golden fixtures, stored as ingest stores them)
 * drained with `drainOnce()` into scans / containers / stacks, latest wins.
 */
import { asc, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { fakeServer } from '../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG } from '../valheim.constants';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from './valheim-armory-import.service';
import { containerPublicKey } from './valheim-armory-containers.import';
import { findLatestContainerScan } from './valheim-containers.repository';

let testApp: TestApp;
let server: number;
const S = schema.valheimLinkSnapshots;
const C = schema.valheimContainers;
const drain = () => testApp.app.get(ValheimArmoryImportService).drainOnce();

const BASIC = 'containers-basic';
const WORLD = '1234567890123';
const T0 = '2026-10-17T20:15:00Z';

type Fixture = Record<string, unknown> & {
  containers: Array<Record<string, unknown>>;
};
const fixture = (name: string): Fixture => loadValheimFixture(name) as Fixture;

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

/** Insert (or replace, as ingest does) a pending snapshot for a message. */
async function push(msg: Record<string, unknown>): Promise<number> {
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

async function statusOf(id: number) {
  const [row] = nonEmpty(
    await testApp.db
      .select({ status: S.status, statusDetail: S.statusDetail })
      .from(S)
      .where(eq(S.id, id)),
    'snapshot row',
  );
  return row;
}

const scans = () => testApp.db.select().from(schema.valheimContainerScans);
const containers = () =>
  testApp.db.select().from(C).orderBy(asc(C.prefab), asc(C.x));
const stacks = () => testApp.db.select().from(schema.valheimContainerStacks);
const keysOf = (rows: Array<{ publicKey: string }>) =>
  rows.map((r) => r.publicKey).sort();
const stackTotal = (f: Fixture) =>
  f.containers.reduce((n, c) => n + (c['items'] as unknown[]).length, 0);

/** A synthetic world of `n` chests × 12 stacks, schema-valid. */
function bigWorld(n: number): Fixture {
  const items = Array.from({ length: 12 }, (_, i) => ({
    prefab: `Mat${i}`,
    quality: 1,
    stack: 10 + i,
  }));
  const containers = Array.from({ length: n }, (_, i) => ({
    prefab: 'piece_chest',
    x: i,
    y: 30,
    z: -i,
    creatorPlayerId: '1000000000000001',
    privacy: i % 10 === 0 ? 'private' : 'public',
    vehicle: false,
    slots: 30,
    usedSlots: 12,
    unreadable: false,
    omittedEntries: 0,
    items,
  }));
  return { ...fixture(BASIC), containers };
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  server = await makeServer();
});

describe('Valheim containers importer (integration)', () => {
  it('first import creates the scan, its containers and their stacks', async () => {
    const f = fixture(BASIC);
    const id = await push(f);
    expect((await drain()).imported).toBe(1);
    expect(await statusOf(id)).toEqual({
      status: 'imported',
      statusDetail: null,
    });
    const [scan] = nonEmpty(await scans(), 'scan');
    expect(scan).toMatchObject({
      pelicanServerId: server,
      worldUid: WORLD,
      gameVersion: '0.220.5',
      omittedShared: 0,
      omittedPrivate: 0,
      containerCount: f.containers.length,
      stackCount: stackTotal(f),
      sourceSnapshotId: id,
    });
    expect(scan.capturedAt.toISOString()).toBe('2026-10-17T20:15:00.000Z');
    const rows = await containers();
    expect(rows).toHaveLength(f.containers.length);
    expect(rows.every((r) => r.scanId === scan.id)).toBe(true);
    expect(rows.every((r) => r.pelicanServerId === server)).toBe(true);
    expect((await stacks()).length).toBe(stackTotal(f));
    const cart = rows.find((r) => r.prefab === 'Cart');
    expect(cart).toMatchObject({ vehicle: true, privacy: 'public' });
    expect(await findLatestContainerScan(testApp.db, server)).toMatchObject({
      id: scan.id,
      worldUid: WORLD,
    });
  });

  it('a newer capturedAt replaces the containers; unchanged chests keep their key', async () => {
    const f = fixture(BASIC);
    await push(f);
    await drain();
    const before = await containers();
    const [scanBefore] = nonEmpty(await scans(), 'scan');
    const kept = f.containers.filter((c) => c['prefab'] !== 'Cart');
    await push({ ...f, capturedAt: '2026-10-17T20:25:00Z', containers: kept });
    expect((await drain()).imported).toBe(1);

    const after = await containers();
    expect(after).toHaveLength(kept.length);
    expect(after.find((r) => r.prefab === 'Cart')).toBeUndefined();
    const keptKeys = keysOf(before.filter((r) => r.prefab !== 'Cart'));
    expect(keysOf(after)).toEqual(keptKeys);
    const oldIds = new Set(before.map((r) => r.id));
    expect(after.filter((r) => oldIds.has(r.id))).toEqual([]);
    expect((await stacks()).length).toBe(
      stackTotal({ ...f, containers: kept }),
    );
    const [scan] = nonEmpty(await scans(), 'scan');
    expect(scan.id).toBe(scanBefore.id);
    expect(scan.capturedAt.toISOString()).toBe('2026-10-17T20:25:00.000Z');
    expect(scan.containerCount).toBe(kept.length);
  });

  it('an older capturedAt is skipped_stale and leaves every row untouched', async () => {
    const f = fixture(BASIC);
    await push({ ...f, capturedAt: '2026-10-17T21:00:00Z' });
    await drain();
    const before = await containers();
    const stacksBefore = (await stacks()).length;
    const id = await push({ ...f, capturedAt: T0, containers: [] });
    expect((await drain()).skipped_stale).toBe(1);
    expect(await statusOf(id)).toEqual({
      status: 'skipped_stale',
      statusDetail: null,
    });
    expect(await containers()).toEqual(before);
    expect((await stacks()).length).toBe(stacksBefore);
    const [scan] = nonEmpty(await scans(), 'scan');
    expect(scan.capturedAt.toISOString()).toBe('2026-10-17T21:00:00.000Z');
  });

  it('an equal capturedAt is skipped_stale too (strictly newer wins, D3)', async () => {
    const f = fixture(BASIC);
    await push(f);
    await drain();
    await push({ ...f, containers: [] });
    expect((await drain()).skipped_stale).toBe(1);
    expect(await containers()).toHaveLength(f.containers.length);
  });

  it('an empty world import leaves zero containers and zero stacks', async () => {
    const f = fixture(BASIC);
    await push(f);
    await drain();
    await push({ ...f, capturedAt: '2026-10-17T20:25:00Z', containers: [] });
    expect((await drain()).imported).toBe(1);
    expect(await containers()).toEqual([]);
    expect(await stacks()).toEqual([]);
    const [scan] = nonEmpty(await scans(), 'scan');
    expect(scan).toMatchObject({ containerCount: 0, stackCount: 0 });
  });

  it('imports the private fixture: privacy as sent, omitted counts, unreadable chest', async () => {
    const f = fixture('containers-private');
    await push(f);
    expect((await drain()).imported).toBe(1);
    const [scan] = nonEmpty(await scans(), 'scan');
    expect(scan).toMatchObject({ omittedShared: 1, omittedPrivate: 1 });
    const rows = await containers();
    expect(rows.map((r) => [r.prefab, r.privacy, r.unreadable])).toEqual([
      ['piece_chest', 'public', true],
      ['piece_chest_private', 'private', false],
      ['piece_chest_wood', 'public', false],
    ]);
    const priv = nonEmpty(
      rows.filter((r) => r.prefab === 'piece_chest_private'),
      'private chest',
    )[0];
    expect(priv.publicKey).toBe(
      containerPublicKey(WORLD, {
        prefab: 'piece_chest_private',
        x: 5,
        y: 32.5,
        z: 5,
        creatorPlayerId: '1000000000000001',
      }),
    );
    expect(
      rows.find((r) => r.prefab === 'piece_chest_wood')?.omittedEntries,
    ).toBe(3);
    expect((await stacks()).length).toBe(stackTotal(f));
  });

  it('a snapshot whose stored world differs from its payload fails with no rows', async () => {
    const id = await push(fixture(BASIC));
    await testApp.db.update(S).set({ worldUid: '999' }).where(eq(S.id, id));
    expect((await drain()).failed).toBe(1);
    expect(await statusOf(id)).toEqual({
      status: 'failed',
      statusDetail: 'invalid:key_mismatch',
    });
    expect(await scans()).toEqual([]);
    expect(await containers()).toEqual([]);
  });

  it('imports a 500-chest / 6 000-stack world inside one drain', async () => {
    const f = bigWorld(500);
    await push(f);
    expect((await drain()).imported).toBe(1);
    expect(await containers()).toHaveLength(500);
    expect((await stacks()).length).toBe(6_000);
  });
});
