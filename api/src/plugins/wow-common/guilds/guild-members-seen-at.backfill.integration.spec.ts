/**
 * ROK-2225 migration 0303 backfill — real database.
 *
 * Seeds pre-migration roster shapes (`ledgerlink_seen_at` / `blizzard_seen_at`
 * NULL, only `last_seen_at` set, as before 0303), runs the migration's own
 * UPDATE statements read from the .sql file (the spec and the migration share
 * one text), then measures the first post-deploy snapshot with the real
 * baseline + movement code. A snapshot equal to the source's previous one
 * must count `0/0` and raise no "Large guild roster change" flag (review r2
 * MAJOR 1: the old backfill dated the last import from a sync's stamps).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { loadBaseline } from '../addon-import/addon-import-guild.baseline';
import {
  isMassRemoval,
  rosterMovement,
  type RosterPresence,
} from '../addon-import/addon-import-guild.guard';

const MIGRATION = join(
  __dirname,
  '../../../drizzle/migrations/0303_guild_members_ledgerlink_seen_at.sql',
);

/** The migration's backfill UPDATEs, verbatim (the ALTERs already ran). */
const backfill = readFileSync(MIGRATION, 'utf8')
  .split('--> statement-breakpoint')
  .filter((s) => /UPDATE "guild_members"/.test(s));

let testApp: TestApp;

const at = (min: number): Date => new Date(Date.UTC(2026, 10, 1, 0, min));
/** Last LedgerLink import, then two Blizzard syncs. */
const I = at(60);
const S1 = at(120);
const S2 = at(180);

interface Seed {
  name: string;
  guid: string | null;
  bid: number | null;
  seen: Date;
}

const paired = (n: number, seen: Date): Seed[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `Paired${i}`,
    guid: `GP${i}`,
    bid: 900 + i,
    seen,
  }));
const importOnly = (n: number, seen: Date): Seed[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `Solo${i}`,
    guid: `GS${i}`,
    bid: null,
    seen,
  }));

async function seedGuild(
  clock: { synced: Date | null; snapshot: Date },
  members: Seed[],
): Promise<number> {
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'WoW backfill', slug: `wow-backfill-${Date.now()}` })
      .returning({ id: schema.games.id }),
    'game',
  );
  const [guild] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: game.id,
        region: 'us',
        name: 'Backfill',
        nameKey: 'backfill',
        source: 'addon_import',
        guildSlug: 'backfill',
        lastSnapshotAt: clock.snapshot,
        blizzardRosterSyncedAt: clock.synced,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  await testApp.db.insert(schema.guildMembers).values(
    members.map((m) => ({
      guildId: guild.id,
      guid: m.guid,
      blizzardCharacterId: m.bid,
      characterName: m.name,
      source: m.guid === null ? 'blizzard' : 'addon_import',
      lastSeenAt: m.seen,
    })),
  );
  return guild.id;
}

async function runBackfill(): Promise<void> {
  expect(backfill).toHaveLength(2);
  for (const statement of backfill) {
    await testApp.db.execute(sql.raw(statement));
  }
}

/** removed/added (+ " FLAG" when a wholesale flag would be raised). */
async function measure(
  guildId: number,
  presence: RosterPresence,
): Promise<string> {
  const base = await loadBaseline(testApp.db, guildId, presence.by);
  const m = rosterMovement(base.rows, presence, base.storedGuids);
  const n = m.counted.length;
  const flag = isMassRemoval(n, m.gone.length) || isMassRemoval(n, m.added);
  return `${m.gone.length}/${m.added}${flag ? ' FLAG' : ''}`;
}

/** The next LedgerLink import listing exactly these GUID rows. */
const importOf = (rows: Seed[]): RosterPresence => ({
  by: 'guid',
  guids: new Set(rows.flatMap((r) => r.guid ?? [])),
});

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// No afterAll truncate: the shared integration setup closes the pool.

describe('ROK-2225 0303 backfill — first post-deploy import', () => {
  it('(i) fully paired guild, latest snapshot a sync: same import is 0/0, no flag', async () => {
    const members = paired(6, S1);
    const guildId = await seedGuild({ synced: S1, snapshot: S1 }, members);
    await runBackfill();
    expect(await measure(guildId, importOf(members))).toBe('0/0');
  });

  it.each<[string, Date | null]>([
    ['I -> S1 -> S2', S2],
    ['slug reset (no sync on record)', null],
  ])(
    '(ii) %s, a paired member gone at S2: the import without him is 0/0, no flag',
    async (_label, synced) => {
      const listed = [...paired(5, S2), ...importOnly(5, I)];
      const gone = { name: 'Gone', guid: 'GX', bid: 950, seen: S1 };
      const fay = { name: 'Fay', guid: null, bid: 990, seen: S2 };
      const guildId = await seedGuild({ synced, snapshot: S2 }, [
        ...listed,
        gone,
        fay,
      ]);
      await runBackfill();
      expect(await measure(guildId, importOf(listed))).toBe('0/0');
    },
  );

  it('(iii) latest snapshot an import listing no import-only rows: members it dropped stay out', async () => {
    const I2 = at(240);
    const listed = paired(6, I2);
    const left = Array.from({ length: 5 }, (_, i) => ({
      name: `Left${i}`,
      guid: `GL${i}`,
      bid: 800 + i,
      seen: S1,
    }));
    const guildId = await seedGuild({ synced: S1, snapshot: I2 }, [
      ...listed,
      ...left,
      ...importOnly(1, at(0)),
    ]);
    await runBackfill();
    expect(await measure(guildId, importOf(listed))).toBe('0/0');
  });

  it('(iv) latest snapshot a sync, only import-only row long departed: paired leavers since are not re-counted', async () => {
    const live = paired(6, S2);
    const leftSince = Array.from({ length: 5 }, (_, i) => ({
      name: `Left${i}`,
      guid: `GL${i}`,
      bid: 800 + i,
      seen: S1,
    }));
    const guildId = await seedGuild({ synced: S2, snapshot: S2 }, [
      ...live,
      ...leftSince,
      ...importOnly(1, at(0)),
    ]);
    await runBackfill();
    // The departed import-only row may have been in the last import: it
    // counts as removed once. The paired leavers must not count again.
    expect(await measure(guildId, importOf(live))).toBe('1/0');
  });
});

describe('ROK-2225 0303 backfill — first post-deploy sync', () => {
  it('I -> S1 -> S2: the same Blizzard roster as S2 is 0/0, no flag', async () => {
    const live = [
      ...paired(5, S2),
      { name: 'Fay', guid: null, bid: 990, seen: S2 },
    ];
    const guildId = await seedGuild({ synced: S2, snapshot: S2 }, [
      ...live,
      { name: 'Gone', guid: 'GX', bid: 950, seen: S1 },
      ...importOnly(5, I),
    ]);
    await runBackfill();
    const rows = await testApp.db
      .select({
        id: schema.guildMembers.id,
        bid: schema.guildMembers.blizzardCharacterId,
      })
      .from(schema.guildMembers);
    const liveBids = new Set(live.map((m) => m.bid));
    const ids = new Set(
      rows
        .filter((r) => r.bid !== null && liveBids.has(r.bid))
        .map((r) => r.id),
    );
    expect(ids.size).toBe(live.length);
    const presence: RosterPresence = { by: 'id', ids, members: live.length };
    expect(await measure(guildId, presence)).toBe('0/0');
  });
});
