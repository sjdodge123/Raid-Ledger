/**
 * TDB:1980 — the lineup timestamp columns hold absolute instants, whatever the
 * DB session zone (follow-up to TDB:1489, which fixed `proposed_time`).
 *
 * The 13 sibling columns on `community_lineups`, `community_lineup_matches`
 * and `community_lineup_match_members` were zone-less `timestamp`. Every raw
 * `NOW()` comparison and every equality against a real instant then shifted
 * by the session TimeZone's offset. A UTC session hides that completely, so
 * the instant checks pin `America/New_York` with `SET LOCAL` inside ONE
 * transaction — the only way to make the bug visible on any host.
 *
 * Expected state:
 *  - RED on a schema without the timestamptz migration: (1) names every column
 *    whose `data_type` is still `timestamp without time zone`; (2) reads
 *    `sameInstant` / `tieExpired` as false, because a naive UTC wall clock is
 *    re-read as New York local time (4h later under EDT, 5h under EST).
 *  - GREEN once both the migration (TDB:1980b) and the offset-aware parser
 *    (TDB:1980a) are in.
 *
 * Inside the transaction callback only `tx` is used: `testApp.db` would take
 * another pooled connection, which the `SET LOCAL` never reaches.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { parseTimestampUtc } from '../drizzle/timestamp-utils';

const HOUR_MS = 60 * 60 * 1000;
const TIMESTAMPTZ = 'timestamp with time zone';

/** Every lineup instant column that must be `timestamptz`, as `table.column`. */
const TZ_COLUMNS = [
  'community_lineups.target_date',
  'community_lineups.voting_deadline',
  'community_lineups.phase_deadline',
  'community_lineups.auto_advance_paused_at',
  'community_lineups.pending_advance_at',
  'community_lineups.nomination_target_below_seen_at',
  'community_lineups.nomination_target_disarmed_at',
  'community_lineups.tie_detected_at',
  'community_lineups.tie_expires_at',
  'community_lineups.tie_expired_at',
  'community_lineups.tie_pick_at',
  'community_lineup_matches.threshold_notified_at',
  'community_lineup_match_members.scheduling_submitted_at',
  // Regression guard for migration 0194 (TDB:1489), already timestamptz.
  'community_lineup_schedule_slots.proposed_time',
] as const;

const TZ_TABLES = [...new Set(TZ_COLUMNS.map((key) => key.split('.')[0]))];

type ColumnRow = { tableName: string; columnName: string; dataType: string };

type NewYorkRead = {
  sameInstant: boolean;
  tieExpired: boolean;
  rawDeadline: Date | string;
};

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** `data_type` per `table.column`, or `MISSING` when the column is absent. */
async function readColumnTypes(): Promise<Record<string, string>> {
  const tables = sql.join(
    TZ_TABLES.map((t) => sql`${t}`),
    sql`, `,
  );
  const rows = (await testApp.db.execute(sql`
    SELECT table_name AS "tableName", column_name AS "columnName",
           data_type AS "dataType"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN (${tables})`)) as unknown as ColumnRow[];
  const byKey = new Map(
    rows.map((r) => [`${r.tableName}.${r.columnName}`, r.dataType]),
  );
  return Object.fromEntries(
    TZ_COLUMNS.map((key) => [key, byKey.get(key) ?? 'MISSING']),
  );
}

/** An open tie hold: deadline an hour ahead, hold expired an hour ago. */
async function seedLineup(deadline: Date, tieExpiresAt: Date): Promise<number> {
  const [lineup] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'TDB:1980 timestamptz proof',
        status: 'voting',
        visibility: 'public',
        createdBy: testApp.seed.adminUser.id,
        publicSlug: 'tz1980proof',
        phaseDeadline: deadline,
        tieDetectedAt: new Date(tieExpiresAt.getTime() - HOUR_MS),
        tieExpiresAt,
      })
      .returning(),
    'lineup',
  );
  return lineup.id;
}

/** Read the seeded row back on ONE connection pinned to New York time. */
async function readUnderNewYork(
  lineupId: number,
  deadline: Date,
): Promise<NewYorkRead> {
  return testApp.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL TIME ZONE 'America/New_York'`);
    const rows = (await tx.execute(sql`
      SELECT phase_deadline = ${deadline.toISOString()}::timestamptz
               AS "sameInstant",
             tie_expires_at <= NOW() AS "tieExpired",
             phase_deadline AS "rawDeadline"
      FROM community_lineups
      WHERE id = ${lineupId}`)) as unknown as NewYorkRead[];
    const [row] = nonEmpty(rows, 'New York read of the seeded lineup');
    return row;
  });
}

describe('Lineup timestamptz columns under a non-UTC session (TDB:1980)', () => {
  it('declares every lineup instant column as timestamptz', async () => {
    const expected = Object.fromEntries(
      TZ_COLUMNS.map((key) => [key, TIMESTAMPTZ]),
    );
    expect(await readColumnTypes()).toEqual(expected);
  });

  it('compares stored instants correctly in a New York session', async () => {
    const deadline = new Date(Date.now() + HOUR_MS);
    const tieExpiresAt = new Date(Date.now() - HOUR_MS);
    const lineupId = await seedLineup(deadline, tieExpiresAt);

    const seen = await readUnderNewYork(lineupId, deadline);

    // `> NOW()` on a FUTURE value would pass on the zone-less column too (it
    // reads later, not earlier), so expiry is proven with a PAST value: a
    // naive UTC hold that ended an hour ago reads ~3h ahead in New York.
    expect({
      sameInstant: seen.sameInstant,
      tieExpired: seen.tieExpired,
    }).toEqual({ sameInstant: true, tieExpired: true });
  });

  it('parses a raw New York read back to the seeded instant', async () => {
    const deadline = new Date(Date.now() + HOUR_MS);
    const lineupId = await seedLineup(deadline, new Date(Date.now() - HOUR_MS));

    const { rawDeadline } = await readUnderNewYork(lineupId, deadline);
    const parsed = parseTimestampUtc(rawDeadline);

    // Green before the migration by construction: a zone-less column returns a
    // naive string, which gets `Z` appended. It guards TDB:1980a only once the
    // timestamptz migration is applied — New York then returns `...-04`, which
    // the old two-part-offset regex misses, producing an Invalid Date (NaN).
    // `raw` rides along so a failure shows the exact wire string.
    expect({ raw: rawDeadline, ms: parsed.getTime() }).toEqual({
      raw: rawDeadline,
      ms: deadline.getTime(),
    });
  });
});
