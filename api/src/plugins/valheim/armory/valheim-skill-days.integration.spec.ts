/**
 * ROK-1882 L2 — per-play-day skill history written by the armory importer
 * (spec §6 AC 1–6). Every timestamp is a fixed `capturedAt` in the snapshot
 * payload; nothing depends on the wall clock.
 */
import { asc, eq } from 'drizzle-orm';
import type { ValheimSkill } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { fakeServer } from '../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG } from '../valheim.constants';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from './valheim-armory-import.service';

let testApp: TestApp;
let server: number;
const S = schema.valheimLinkSnapshots;
const D = schema.valheimProfileSkillDays;
const settings = () => testApp.app.get(SettingsService);

const skills = (swords: number, run = 41): ValheimSkill[] => [
  { id: 'Swords', level: swords, accumulator: 0 },
  { id: 'Run', level: run, accumulator: 0 },
];

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

/** Store (or replace, as ingest does) the character snapshot, then drain once. */
async function importAt(
  capturedAt: string,
  sk: ValheimSkill[],
): Promise<string> {
  const msg = {
    ...loadValheimFixture('character-vanilla'),
    capturedAt,
    skills: sk,
  };
  const row = valheimSnapshotRow(server, msg as never);
  const [snap] = nonEmpty(
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
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
  const [done] = nonEmpty(
    await testApp.db
      .select({ status: S.status })
      .from(S)
      .where(eq(S.id, snap.id)),
    'snapshot status',
  );
  return done.status;
}

const dayRows = () => testApp.db.select().from(D).orderBy(asc(D.playDate));
const playDates = async () => (await dayRows()).map((r) => r.playDate);
const setServerTz = (tz: string | null) =>
  testApp.db
    .update(schema.pelicanServers)
    .set({ timezone: tz })
    .where(eq(schema.pelicanServers.id, server));

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  settings().invalidateCache(true);
  server = await makeServer();
});

afterEach(() => settings().invalidateCache(true));

describe('Valheim skill play days (ROK-1882)', () => {
  it('AC1: a new play day stores the skills before the import as start, the snapshot as end', async () => {
    await importAt('2026-10-17T20:15:00Z', skills(10));
    await importAt('2026-10-18T20:00:00Z', skills(12.5));
    const [first, second] = await dayRows();
    expect(first).toMatchObject({
      playDate: '2026-10-17',
      startSkills: skills(10),
      endSkills: skills(10),
    });
    expect(second).toMatchObject({
      playDate: '2026-10-18',
      startSkills: skills(10),
      endSkills: skills(12.5),
    });
    expect(second?.firstSeenAt.toISOString()).toBe('2026-10-18T20:00:00.000Z');
  });

  it('AC2: a later import the same play day moves only end_skills and last_seen_at', async () => {
    await importAt('2026-10-17T20:15:00Z', skills(10));
    await importAt('2026-10-18T20:00:00Z', skills(12));
    await importAt('2026-10-18T23:30:00Z', skills(14, 42));
    const rows = await dayRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      playDate: '2026-10-18',
      startSkills: skills(10),
      endSkills: skills(14, 42),
    });
    expect(rows[1]?.firstSeenAt.toISOString()).toBe('2026-10-18T20:00:00.000Z');
    expect(rows[1]?.lastSeenAt.toISOString()).toBe('2026-10-18T23:30:00.000Z');
  });

  it('AC3: with no timezone anywhere a play day is the UTC date', async () => {
    await importAt('2026-10-21T03:00:00Z', skills(10));
    expect(await playDates()).toEqual(['2026-10-21']);
  });

  it('AC3: with no server timezone the community default_timezone buckets the day', async () => {
    await settings().setDefaultTimezone('America/New_York');
    await importAt('2026-10-21T03:00:00Z', skills(10));
    expect(await playDates()).toEqual(['2026-10-20']);
  });

  it("AC3 (ruling 2026-10-21): the game server's timezone wins over the community default", async () => {
    await settings().setDefaultTimezone('Asia/Tokyo');
    await setServerTz('America/New_York');
    await importAt('2026-10-21T03:00:00Z', skills(10));
    expect(await playDates()).toEqual(['2026-10-20']);
  });

  it('AC3: an invalid server timezone falls back to the community default instead of failing', async () => {
    await settings().setDefaultTimezone('America/New_York');
    await setServerTz('Not/AZone');
    expect(await importAt('2026-10-21T03:00:00Z', skills(10))).toBe('imported');
    expect(await playDates()).toEqual(['2026-10-20']);
  });

  it('AC4: a stale snapshot writes no play-day row', async () => {
    await importAt('2026-10-18T20:00:00Z', skills(12));
    expect(await importAt('2026-10-16T20:00:00Z', skills(5))).toBe(
      'skipped_stale',
    );
    expect(await playDates()).toEqual(['2026-10-18']);
    expect((await dayRows())[0]?.endSkills).toEqual(skills(12));
  });

  it('AC5: after an 11th distinct play day only the 10 newest remain', async () => {
    for (let day = 1; day <= 11; day += 1) {
      const dd = String(day).padStart(2, '0');
      await importAt(`2026-10-${dd}T20:00:00Z`, skills(10 + day));
    }
    const dates = await playDates();
    expect(dates).toHaveLength(10);
    expect(dates[0]).toBe('2026-10-02');
    expect(dates[9]).toBe('2026-10-11');
  });

  it('AC6: deleting the profile deletes its play days', async () => {
    await importAt('2026-10-17T20:15:00Z', skills(10));
    await importAt('2026-10-18T20:00:00Z', skills(12));
    expect(await dayRows()).toHaveLength(2);
    await testApp.db.delete(schema.valheimProfiles);
    expect(await dayRows()).toEqual([]);
  });
});
