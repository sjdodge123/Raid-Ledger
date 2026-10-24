/**
 * ROK-1946 lane A — the portals importer against a real database: pending
 * `portals` snapshots (golden fixtures, stored as ingest stores them) drained
 * with `drainOnce()` into `valheim_portal_scans` / `valheim_portals`. The
 * latest scan per (server, world) replaces that world's portals wholesale.
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

let testApp: TestApp;
let server: number;
const S = schema.valheimLinkSnapshots;
const P = schema.valheimPortals;
const H = schema.valheimPortalScans;
const drain = () => testApp.app.get(ValheimArmoryImportService).drainOnce();

const WORLD = '1234567890123';
const OTHER_WORLD = '9876543210987';

type Portal = Record<string, unknown> & { tag: string; prefab: string };
type Fixture = Record<string, unknown> & { portals: Portal[] };
const fixture = (name: string): Fixture => loadValheimFixture(name) as Fixture;
const vanilla = () => fixture('portals-vanilla');

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

const scans = () => testApp.db.select().from(H).orderBy(asc(H.worldUid));
const portals = () => testApp.db.select().from(P).orderBy(asc(P.x), asc(P.z));
const tagsOf = (rows: Array<{ tag: string }>) => rows.map((r) => r.tag).sort();

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  server = await makeServer();
});

describe('Valheim portals importer (integration, ROK-1946)', () => {
  it('first scan stores every portal under one header; snapshot imported', async () => {
    const f = vanilla();
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
      omitted: 0,
      portalCount: f.portals.length,
      sourceSnapshotId: id,
    });
    expect(scan.capturedAt.toISOString()).toBe('2026-10-17T20:15:00.000Z');
    const rows = await portals();
    expect(rows).toHaveLength(f.portals.length);
    expect(rows.every((r) => r.scanId === scan.id)).toBe(true);
    expect(rows.every((r) => r.pelicanServerId === server)).toBe(true);
    expect(tagsOf(rows)).toEqual(tagsOf(f.portals));
  });

  it('a newer scan without one portal replaces the world: that portal is gone', async () => {
    const f = vanilla();
    await push(f);
    await drain();
    const [gone, ...kept] = f.portals;
    await push({ ...f, capturedAt: '2026-10-17T20:25:00Z', portals: kept });
    expect((await drain()).imported).toBe(1);
    const rows = await portals();
    expect(rows).toHaveLength(kept.length);
    expect(
      rows.find((r) => r.x === gone?.['x'] && r.z === gone?.['z']),
    ).toBeUndefined();
    const [scan] = nonEmpty(await scans(), 'scan');
    expect(scan.portalCount).toBe(kept.length);
    expect(scan.capturedAt.toISOString()).toBe('2026-10-17T20:25:00.000Z');
  });

  it('an empty newer scan clears the world; an older scan then stays skipped_stale', async () => {
    const f = vanilla();
    await push(f);
    await drain();
    await push({ ...f, capturedAt: '2026-10-17T21:00:00Z', portals: [] });
    expect((await drain()).imported).toBe(1);
    expect(await portals()).toEqual([]);
    const [scan] = nonEmpty(await scans(), 'scan');
    expect(scan.portalCount).toBe(0);
    expect(scan.capturedAt.toISOString()).toBe('2026-10-17T21:00:00.000Z');

    const stale = await push({ ...f, capturedAt: '2026-10-17T20:30:00Z' });
    expect((await drain()).skipped_stale).toBe(1);
    expect(await statusOf(stale)).toEqual({
      status: 'skipped_stale',
      statusDetail: null,
    });
    expect(await portals()).toEqual([]);
    const [after] = nonEmpty(await scans(), 'scan');
    expect(after.capturedAt.toISOString()).toBe('2026-10-17T21:00:00.000Z');
  });

  it('an equal capturedAt is skipped_stale and leaves the rows untouched', async () => {
    const f = vanilla();
    await push(f);
    await drain();
    const before = await portals();
    const again = await push({ ...f, portals: f.portals.slice(1) });
    expect((await drain()).skipped_stale).toBe(1);
    expect((await statusOf(again)).status).toBe('skipped_stale');
    expect(await portals()).toEqual(before);
  });

  it('two worlds on one server are independent', async () => {
    const f = vanilla();
    await push(f);
    await push({ ...f, worldUid: OTHER_WORLD, portals: f.portals.slice(0, 1) });
    expect((await drain()).imported).toBe(2);
    await push({
      ...f,
      worldUid: OTHER_WORLD,
      capturedAt: '2026-10-17T20:45:00Z',
      portals: [],
    });
    await drain();
    const [a, b] = await scans();
    expect(a).toMatchObject({ worldUid: WORLD, portalCount: f.portals.length });
    expect(b).toMatchObject({ worldUid: OTHER_WORLD, portalCount: 0 });
    const rows = await portals();
    expect(rows).toHaveLength(f.portals.length);
    expect(rows.every((r) => r.scanId === a?.id)).toBe(true);
  });

  it('modded fixture: prefab verbatim, y null stored as NULL, omitted kept', async () => {
    const f = fixture('portals-modded');
    await push(f);
    expect((await drain()).imported).toBe(1);
    const rows = await portals();
    const odd = rows.find((r) => r.prefab === 'portal_xportal_fixture');
    expect(odd).toMatchObject({ x: 900, y: null, z: 900, tag: 'Hub Gate' });
    expect(rows.map((r) => r.prefab)).toContain('portal_blackmarble');
    const [scan] = nonEmpty(await scans(), 'scan');
    expect(scan.omitted).toBe(f['omitted']);
  });

  it('an empty tag is stored as the empty string', async () => {
    const f = vanilla();
    const empties = f.portals.filter((p) => p.tag === '').length;
    expect(empties).toBeGreaterThan(0);
    await push(f);
    expect((await drain()).imported).toBe(1);
    const rows = await portals();
    expect(rows.filter((r) => r.tag === '')).toHaveLength(empties);
  });
});
