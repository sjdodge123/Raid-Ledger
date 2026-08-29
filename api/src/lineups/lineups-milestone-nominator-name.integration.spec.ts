/**
 * ROK-1439 — regression coverage for the nomination-milestone nominator name.
 *
 * `users.display_name` is nullable while `users.username` is notNull, so
 * `getEntryDetails` must COALESCE the two. Before the fix it selected
 * `display_name` raw and mapped NULL to the literal `'Unknown'`, which is what
 * every entry in the prod milestone embed rendered as.
 *
 * This is an integration spec rather than a unit test on purpose: the defect
 * and the fix both live in the SQL projection, so only a real Postgres round
 * trip can prove it (a drizzle-mock assertion would pass either way).
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { getEntryDetails } from './lineups-milestone.helpers';

function describeMilestoneNominatorName() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  /**
   * `truncateAllTables` uses `DELETE FROM`, not `TRUNCATE ... RESTART
   * IDENTITY`, so ids climb monotonically for the life of a shard's DB. A
   * fresh local DB therefore hands out 1-digit ids while CI's shared shard DB
   * is already into the thousands — which is how a fixture slug that fits
   * `public_slug varchar(16)` locally can overflow only in CI.
   *
   * Advancing the sequence here reproduces the CI id range locally, so this
   * spec fails on the developer's machine rather than on the PR.
   */
  beforeEach(async () => {
    // GREATEST(...) keeps this above the ids `truncateAllTables` just
    // re-seeded, so advancing the sequence never collides with a seed row.
    await testApp.db.execute(
      sql`SELECT setval(
        pg_get_serial_sequence('users', 'id'),
        GREATEST(500000, (SELECT COALESCE(MAX(id), 0) FROM users))
      )`,
    );
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function insertUser(
    username: string,
    displayName: string | null,
  ): Promise<number> {
    const [row] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${username}@test.local`,
        username,
        displayName,
        role: 'member',
      })
      .returning();
    return row.id;
  }

  async function insertGame(slug: string): Promise<number> {
    const [row] = await testApp.db
      .insert(schema.games)
      .values({ name: slug, slug, coverUrl: null, igdbId: null })
      .returning();
    return row.id;
  }

  /**
   * `public_slug` is `varchar(16)` and UNIQUE, so the fixture slug must stay
   * short enough for any user id the sequence has reached. CI's shared shard
   * DB hands out 4-digit ids where a fresh local DB hands out 1-digit ones,
   * so a long prefix passes locally and overflows in CI. `ls-` + id leaves
   * room for a 13-digit id.
   */
  async function insertLineup(createdBy: number): Promise<number> {
    const [row] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Milestone name lineup',
        createdBy,
        publicSlug: `ls-${createdBy}`,
      })
      .returning();
    return row.id;
  }

  /** `uq_lineup_entry_game` is unique on (lineup_id, game_id). */
  async function nominate(lineupId: number, userId: number, slug: string) {
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId: await insertGame(slug),
      nominatedBy: userId,
    });
  }

  it('falls back to username when the nominator has no display name', async () => {
    const namelessId = await insertUser('halo_fan', null);
    const lineupId = await insertLineup(namelessId);
    await nominate(lineupId, namelessId, 'milestone-name-g1');

    const [entry] = await getEntryDetails(testApp.db, lineupId);

    expect(entry.nominatorName).toBe('halo_fan');
    expect(entry.nominatorName).not.toBe('Unknown');
  });

  it('still prefers the display name when one is set', async () => {
    const namedId = await insertUser('drg_fan', 'Rock and Stone');
    const lineupId = await insertLineup(namedId);
    await nominate(lineupId, namedId, 'milestone-name-g2');

    const [entry] = await getEntryDetails(testApp.db, lineupId);

    expect(entry.nominatorName).toBe('Rock and Stone');
  });

  it('resolves a mixed roster without collapsing anyone to Unknown', async () => {
    const namelessId = await insertUser('b4b_fan', null);
    const namedId = await insertUser('ror_fan', 'Commando');
    const lineupId = await insertLineup(namedId);
    await nominate(lineupId, namelessId, 'milestone-name-g3');
    await nominate(lineupId, namedId, 'milestone-name-g4');

    const details = await getEntryDetails(testApp.db, lineupId);

    expect(details.map((d) => d.nominatorName).sort()).toEqual([
      'Commando',
      'b4b_fan',
    ]);
  });
}

describe(
  'Lineups — milestone nominator name (integration)',
  describeMilestoneNominatorName,
);
