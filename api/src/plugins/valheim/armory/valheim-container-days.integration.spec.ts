/**
 * ROK-2014 L2 — the containers' play-day snapshot against a real database:
 * every fresh scan drained through the real importer writes its play day's
 * end-of-day totals (diff-written), buckets by the server's timezone, prunes
 * past 30 days and skips stale scans; the demo seed's `trendDays: 3` adds
 * three earlier days.
 */
import { asc, eq } from 'drizzle-orm';
import {
  ValheimContainersMessageSchema,
  type ValheimContainer,
  type ValheimContainersMessage,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { fakeServer } from '../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG } from '../valheim.constants';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from './valheim-armory-import.service';
import { importDemoContainers } from './valheim-armory-containers-demo-seed.helpers';
import { CONTAINERS_DEMO_MESSAGE } from './valheim-armory-containers-demo-fixture';
import { CONTAINER_DAYS_RETAINED } from './valheim-container-days.helpers';

let testApp: TestApp;
let server: number;
const S = schema.valheimLinkSnapshots;
const D = schema.valheimContainerDays;
const I = schema.valheimContainerItemDays;
const B = schema.valheimContainerBaseItemDays;
const drain = () => testApp.app.get(ValheimArmoryImportService).drainOnce();

const T0 = '2026-10-17T20:15:00Z';
type Item = ValheimContainer['items'][number];
type Msg = ValheimContainersMessage;

const basic = (): Msg =>
  ValheimContainersMessageSchema.parse(loadValheimFixture('containers-basic'));

/** containers-basic at `capturedAt`, its first chest's items replaced. */
function scanAt(capturedAt: string, firstChestItems?: Item[]): Msg {
  const f = basic();
  const [first, ...rest] = f.containers;
  if (!first) throw new Error('containers-basic has no chests');
  const head = firstChestItems ? { ...first, items: firstChestItems } : first;
  return { ...f, capturedAt, containers: [head, ...rest] };
}

async function makeServer(timezone: string | null = null): Promise<number> {
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
        timezone,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  return row.id;
}

/** Store a pending snapshot (as ingest does) and drain it. */
async function pushAndDrain(msg: Msg): Promise<number> {
  const row = valheimSnapshotRow(server, msg);
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
  return (await drain()).imported;
}

const dayRows = () => testApp.db.select().from(D).orderBy(asc(D.playDate));
const itemRows = () =>
  testApp.db
    .select({
      id: I.id,
      date: D.playDate,
      prefab: I.prefab,
      vehicle: I.vehicle,
      owner: I.owner,
      total: I.total,
    })
    .from(I)
    .innerJoin(D, eq(D.id, I.dayId))
    .orderBy(asc(D.playDate), asc(I.prefab), asc(I.vehicle));
const totalOf = async (date: string, prefab: string, vehicle = false) =>
  (await itemRows()).find(
    (r) => r.date === date && r.prefab === prefab && r.vehicle === vehicle,
  )?.total;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  server = await makeServer();
});

describe('Valheim container play days (integration)', () => {
  it('a first scan writes its UTC play day with item and base totals', async () => {
    expect(await pushAndDrain(scanAt(T0))).toBe(1);
    const days = await dayRows();
    expect(days.map((d) => d.playDate)).toEqual(['2026-10-17']);
    expect(await totalOf('2026-10-17', 'Wood')).toBe(57);
    expect(await totalOf('2026-10-17', 'Wood', true)).toBe(99);
    expect(await totalOf('2026-10-17', 'BlackMetal')).toBe(120);
    const bases = await testApp.db.select().from(B);
    expect(new Set(bases.map((b) => b.baseKey)).size).toBe(1);
    expect(bases.filter((b) => b.prefab === 'Wood').length).toBe(2);
  });

  it('a later scan the same day keeps the end-of-day picture (diff write)', async () => {
    await pushAndDrain(scanAt(T0));
    const before = await itemRows();
    const later = '2026-10-17T22:00:00Z';
    await pushAndDrain(
      scanAt(later, [{ prefab: 'Wood', quality: 1, stack: 80 }]),
    );
    const after = await itemRows();
    expect(await totalOf('2026-10-17', 'Wood')).toBe(87);
    expect(after.some((r) => r.prefab === 'Stone')).toBe(false);
    const bm = (rows: typeof before) =>
      rows.find((r) => r.prefab === 'BlackMetal')?.id;
    expect(bm(after)).toBe(bm(before));
    const [day] = nonEmpty(await dayRows(), 'day');
    expect(day.lastCapturedAt.toISOString()).toBe('2026-10-17T22:00:00.000Z');
    expect(day.firstCapturedAt.toISOString()).toBe('2026-10-17T20:15:00.000Z');
  });

  it('a scan on the next day opens a new day and keeps the old one', async () => {
    await pushAndDrain(scanAt(T0));
    await pushAndDrain(scanAt('2026-10-18T09:00:00Z'));
    expect((await dayRows()).map((d) => d.playDate)).toEqual([
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(await totalOf('2026-10-17', 'Wood')).toBe(57);
    expect(await totalOf('2026-10-18', 'Wood')).toBe(57);
  });

  it("buckets by the game server's own timezone", async () => {
    await testApp.db
      .update(schema.pelicanServers)
      .set({ timezone: 'America/Los_Angeles' })
      .where(eq(schema.pelicanServers.id, server));
    await pushAndDrain(scanAt('2026-10-18T03:00:00Z'));
    expect((await dayRows()).map((d) => d.playDate)).toEqual(['2026-10-17']);
  });
});

describe('Valheim container play days — retention, stale, demo (integration)', () => {
  it(`prunes days ${CONTAINER_DAYS_RETAINED}+ calendar days old, rows included`, async () => {
    const old = (playDate: string) => ({
      pelicanServerId: server,
      worldUid: CONTAINERS_DEMO_MESSAGE.worldUid,
      playDate,
      firstCapturedAt: new Date(`${playDate}T12:00:00Z`),
      lastCapturedAt: new Date(`${playDate}T12:00:00Z`),
    });
    const [gone] = nonEmpty(
      await testApp.db
        .insert(D)
        .values([old('2026-09-17'), old('2026-09-18')])
        .returning({ id: D.id }),
      'old days',
    );
    await testApp.db.insert(I).values({
      dayId: gone.id,
      prefab: 'Wood',
      vehicle: false,
      owner: '',
      total: 5,
    });
    await pushAndDrain(scanAt(T0));
    expect((await dayRows()).map((d) => d.playDate)).toEqual([
      '2026-09-18',
      '2026-10-17',
    ]);
    const orphans = await testApp.db
      .select()
      .from(I)
      .where(eq(I.dayId, gone.id));
    expect(orphans).toEqual([]);
  });

  it('a stale scan writes no day rows', async () => {
    await pushAndDrain(scanAt('2026-10-18T09:00:00Z'));
    await pushAndDrain(scanAt(T0));
    expect((await dayRows()).map((d) => d.playDate)).toEqual(['2026-10-18']);
  });

  it('the demo seed with trendDays: 3 stores four days ending at the scan', async () => {
    await importDemoContainers(testApp.db, server, false, 3);
    expect((await dayRows()).map((d) => d.playDate)).toEqual([
      '2026-10-11',
      '2026-10-14',
      '2026-10-16',
      '2026-10-17',
    ]);
    const wood = ['2026-10-11', '2026-10-14', '2026-10-16', '2026-10-17'];
    const totals = await Promise.all(wood.map((d) => totalOf(d, 'Wood')));
    expect(totals).toEqual([12, 22, 37, 57]);
    expect(await totalOf('2026-10-16', 'Stone')).toBe(30);
    await importDemoContainers(testApp.db, server, false, 0);
    expect((await dayRows()).map((d) => d.playDate)).toEqual(['2026-10-17']);
  });
});
