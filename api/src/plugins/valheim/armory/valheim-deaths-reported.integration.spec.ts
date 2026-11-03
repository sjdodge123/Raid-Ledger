/**
 * ROK-1931 S2 — the mod's reported deaths (`character.deaths[]`) against a
 * real database: character snapshots drained by the armory importer (SQL R),
 * console deaths through the deaths repository (SQL B), death-post rows as
 * the screenshot linker stores them. One row per death across sources.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { defined, nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { fakeServer } from '../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG } from '../valheim.constants';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from './valheim-armory-import.service';
import { ValheimDeathsRepository } from './valheim-deaths.repository';

/** `character-deaths.json`: Testviking, world 1234567890123, deathCount 7. */
const FIXTURE = 'character-deaths';
const STEAM = '76561198000000001';
const OTHER_STEAM = '76561198000000099';
const PLAYER_ID = '1000000000000001';
const WORLD = '1234567890123';
const FOREIGN_WORLD = '987654321';
const CAPTURED = '2026-10-17T20:15:00.000Z';
/** The fixture's two deaths on this world (the third is on FOREIGN_WORLD). */
const DEATH_1 = { at: '2026-10-17T20:05:12.000Z', x: -412.5, z: 1210.25 };
const DEATH_2 = { at: '2026-10-15T21:02:33.125Z', x: 1830.125, z: -655 };
const FOREIGN_AT = '2026-10-16T18:40:00.500Z';

let testApp: TestApp;
let server: number;
const S = schema.valheimLinkSnapshots;
const D = schema.valheimPlayerDeaths;
const drain = () => testApp.app.get(ValheimArmoryImportService).drainOnce();
const repo = () => testApp.app.get(ValheimDeathsRepository);
const rows = () => testApp.db.select().from(D).orderBy(D.occurredAt);
const iso = (d: Date | null) => d?.toISOString() ?? null;

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

/**
 * Insert (or replace, as ingest does) a pending character snapshot: the
 * fixture with `edit` applied and the `omit` keys removed.
 */
async function push(
  edit: Record<string, unknown> = {},
  omit: readonly string[] = [],
): Promise<number> {
  const msg: Record<string, unknown> = {
    ...loadValheimFixture(FIXTURE),
    ...edit,
  };
  for (const key of omit) delete msg[key];
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

async function snapshot(id: number) {
  const [row] = nonEmpty(
    await testApp.db
      .select({ status: S.status, statusDetail: S.statusDetail })
      .from(S)
      .where(eq(S.id, id)),
    'snapshot row',
  );
  return row;
}

async function profile() {
  const [p] = nonEmpty(
    await testApp.db.select().from(schema.valheimProfiles),
    'profile',
  );
  return p;
}

/** A console death, zone-less stamp read as UTC (no server timezone). */
function logDeath(stamp: string, steamId: string | null = STEAM) {
  return repo().recordLogDeath(server, {
    characterName: 'Testviking',
    steamId,
    loggedAt: stamp,
    occurredAt: new Date(`${stamp}Z`),
  });
}

/** A death inferred from a Discord death post (no SteamID, no position). */
async function discordDeath(occurredAt: string): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(D)
      .values({
        pelicanServerId: server,
        characterName: 'testviking',
        source: 'discord',
        occurredAt: new Date(occurredAt),
      })
      .returning({ id: D.id }),
    'discord death',
  );
  return row.id;
}

/** The stored row whose reported `at` is `at`, or a descriptive throw. */
async function reported(at: string) {
  const all = await rows();
  return defined(
    all.find((r) => iso(r.reportedAt) === at),
    `row with reported_at ${at} (rows: ${all.map((r) => iso(r.reportedAt)).join(',')})`,
  );
}

/** Total deaths the Deaths widget would count on this server (D7: rows). */
async function counted(): Promise<number> {
  const { groups } = await repo().countByPlayer(server);
  return groups.reduce((n, g) => n + g.deaths, 0);
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  server = await makeServer();
});

describe('Valheim reported deaths (integration, ROK-1931)', () => {
  it('stores each on-world reported death once as a mod row; deathCount lands on the profile', async () => {
    const id = await push();
    expect((await drain()).imported).toBe(1);
    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(await reported(DEATH_1.at)).toMatchObject({
      pelicanServerId: server,
      characterName: 'Testviking',
      steamId: STEAM,
      playerId: PLAYER_ID,
      worldUid: WORLD,
      source: 'mod',
      loggedAt: null,
      x: DEATH_1.x,
      z: DEATH_1.z,
    });
    expect(iso((await reported(DEATH_1.at)).occurredAt)).toBe(DEATH_1.at);
    expect(await snapshot(id)).toEqual({
      status: 'imported',
      statusDetail: 'deaths_foreign:1',
    });
    const p = await profile();
    expect(p.deathCount).toBe(7);
    expect(iso(p.deathCountAt)).toBe(CAPTURED);
  });

  it('re-uploading the same deaths (replay and a newer snapshot) adds no rows (AC4)', async () => {
    await push();
    await drain();
    const id = await push();
    expect((await drain()).imported).toBe(1);
    await push({ capturedAt: '2026-10-17T21:00:00Z' });
    expect((await drain()).imported).toBe(1);
    expect(await snapshot(id)).toEqual({
      status: 'imported',
      statusDetail: 'deaths_foreign:1',
    });
    expect((await rows()).map((r) => iso(r.reportedAt)).sort()).toEqual(
      [DEATH_2.at, DEATH_1.at].sort(),
    );
  });

  it('ignores a death on another world (AC7)', async () => {
    await push();
    await drain();
    const stored = await rows();
    expect(stored.map((r) => r.worldUid)).not.toContain(FOREIGN_WORLD);
    expect(stored.map((r) => iso(r.reportedAt))).not.toContain(FOREIGN_AT);
    expect(stored.map((r) => r.x)).not.toContain(88);
  });

  it('merges into an unpositioned log death within 120 s; one outside stays apart (AC5)', async () => {
    expect(await logDeath('2026-10-17T20:04:30')).toBe(true); // 42 s early
    expect(await logDeath('2026-10-17T20:07:20')).toBe(true); // 128 s late
    await push();
    await drain();
    const merged = await reported(DEATH_1.at);
    expect(merged).toMatchObject({
      source: 'log',
      loggedAt: '2026-10-17T20:04:30',
      steamId: STEAM,
      playerId: PLAYER_ID,
      worldUid: WORLD,
      x: DEATH_1.x,
      z: DEATH_1.z,
    });
    const late = defined(
      (await rows()).find((r) => r.loggedAt === '2026-10-17T20:07:20'),
      'the out-of-window log row',
    );
    expect(late).toMatchObject({ x: null, z: null, reportedAt: null });
    // The log death + the 128 s one + DEATH_2 (no partner): 3 deaths, not 4.
    expect(await rows()).toHaveLength(3);
    expect(await counted()).toBe(3);
  });

  it('merges into a discord death of the same name (no SteamID) and attributes it (AC5)', async () => {
    const id = await discordDeath('2026-10-17T20:06:00Z'); // 48 s late
    await push();
    await drain();
    const [row] = nonEmpty(
      await testApp.db.select().from(D).where(eq(D.id, id)),
      'discord row',
    );
    expect(row).toMatchObject({
      source: 'discord',
      // The OCR casing ('testviking') gives way to the profile name.
      characterName: 'Testviking',
      steamId: STEAM,
      playerId: PLAYER_ID,
      worldUid: WORLD,
      x: DEATH_1.x,
      z: DEATH_1.z,
    });
    expect(iso(row.reportedAt)).toBe(DEATH_1.at);
    expect(await rows()).toHaveLength(2);
  });

  it('a log line arriving after the mod row merges into it; the count does not change (AC6)', async () => {
    await push();
    await drain();
    expect(await counted()).toBe(2);
    expect(await logDeath('2026-10-17T20:06:00')).toBe(false); // 48 s late
    const merged = await reported(DEATH_1.at);
    expect(merged).toMatchObject({
      source: 'log',
      loggedAt: '2026-10-17T20:06:00',
      steamId: STEAM,
      playerId: PLAYER_ID,
      worldUid: WORLD,
      x: DEATH_1.x,
      z: DEATH_1.z,
    });
    expect(iso(merged.occurredAt)).toBe('2026-10-17T20:06:00.000Z');
    expect(await rows()).toHaveLength(2);
    expect(await counted()).toBe(2);
    // A re-upload after the log merge still finds the row by reported_at.
    await push({ capturedAt: '2026-10-17T21:00:00Z' });
    await drain();
    expect(await rows()).toHaveLength(2);
  });

  it("a same-name log death from another SteamID never merges into this character's mod row (D6)", async () => {
    await push();
    await drain();
    expect(await logDeath('2026-10-17T20:05:30', OTHER_STEAM)).toBe(true);
    expect(await reported(DEATH_1.at)).toMatchObject({
      source: 'mod',
      steamId: STEAM,
      loggedAt: null,
    });
    expect(await rows()).toHaveLength(3);
  });

  it('an unattributed log death (no SteamID yet) still merges into the mod row by name (D6)', async () => {
    await push();
    await drain();
    expect(await logDeath('2026-10-17T20:05:30', null)).toBe(false);
    expect(await reported(DEATH_1.at)).toMatchObject({
      source: 'log',
      steamId: STEAM,
      loggedAt: '2026-10-17T20:05:30',
    });
    expect(await rows()).toHaveLength(2);
  });

  it('a stale snapshot stores none of its deaths and keeps the newer deathCount (AC8)', async () => {
    const first = {
      worldUid: WORLD,
      x: DEATH_1.x,
      z: DEATH_1.z,
      at: '2026-10-17T20:05:12Z',
    };
    await push({
      capturedAt: '2026-10-17T21:00:00Z',
      deathCount: 9,
      deaths: [first],
    });
    expect((await drain()).imported).toBe(1);
    const id = await push();
    expect((await drain()).skipped_stale).toBe(1);
    expect((await snapshot(id)).status).toBe('skipped_stale');
    expect((await rows()).map((r) => iso(r.reportedAt))).toEqual([DEATH_1.at]);
    const p = await profile();
    expect(p.deathCount).toBe(9);
    expect(iso(p.deathCountAt)).toBe('2026-10-17T21:00:00.000Z');
  });

  it('a newer snapshot without deathCount keeps the stored count and its timestamp (Q3: absent is not zero)', async () => {
    await push();
    await drain();
    await push({ capturedAt: '2026-10-17T21:00:00Z' }, ['deathCount']);
    expect((await drain()).imported).toBe(1);
    const p = await profile();
    expect(iso(p.capturedAt)).toBe('2026-10-17T21:00:00.000Z');
    expect(p.deathCount).toBe(7);
    expect(iso(p.deathCountAt)).toBe(CAPTURED);
  });

  it('the per-player count equals the stored rows across log, discord and mod sources (D7)', async () => {
    await logDeath('2026-10-17T20:04:30'); // merges with DEATH_1
    await discordDeath('2026-10-15T21:03:00Z'); // merges with DEATH_2
    await logDeath('2026-10-16T10:00:00'); // no reported partner
    await push();
    await drain();
    await push({ capturedAt: '2026-10-17T21:00:00Z' });
    await drain();
    const stored = await rows();
    expect(stored).toHaveLength(3);
    expect(stored.filter((r) => r.source === 'mod')).toHaveLength(0);
    expect(await counted()).toBe(stored.length);
    // Every bucket is this player's — the merges attributed the discord row.
    const { groups } = await repo().countByPlayer(server);
    expect(groups.map((g) => g.steamId)).toEqual(groups.map(() => STEAM));
    // One bucket: the merged discord row no longer splits on name casing.
    expect(groups.map((g) => [g.characterName, g.deaths])).toEqual([
      ['Testviking', 3],
    ]);
  });
});
