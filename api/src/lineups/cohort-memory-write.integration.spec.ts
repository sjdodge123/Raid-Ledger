/**
 * Cohort-memory write-trigger integration tests (ROK-1309 S2, real DB).
 *
 * Covers the two AC trigger points and the idempotency guarantee:
 *   1. voting -> decided writes one `decided` row for `decidedGameId`
 *      plus one `match` row per match-tier game.
 *   2. tiebreaker resolution writes one `veto_won` row for the survivor
 *      and one `veto_lost` row per game vetoed out.
 *   3. Replaying BOTH triggers inserts zero additional rows.
 *
 * Case 3 is the vacuous-test-prone one — it is verified by reverting
 * (drop `.onConflictDoNothing()` and it must go red on a duplicate key).
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { resolveTiebreaker } from './tiebreaker/tiebreaker-lifecycle.helpers';
import { writeDecidedCohortMemory } from './cohort-memory-write.helpers';
import { buildCohortSignature } from './cohort-memory-signature.helpers';

function describeCohortMemoryWrites() {
  let testApp: TestApp;
  let adminToken: string;
  let adminId: number;
  let cohort: number[];
  let games: number[];
  let lineupId: number;

  const memoryRows = () =>
    testApp.db.select().from(schema.communityLineupCohortMemory);

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    const seed = await truncateAllTables(testApp.db, testApp);
    adminId = seed.adminUser.id;
    adminToken = await loginAsAdmin(testApp.request, seed);

    const users = await testApp.db
      .insert(schema.users)
      .values(
        [1, 2, 3].map((n) => ({
          discordId: `cohort-${n}`,
          username: `cohort${n}`,
          role: 'user' as const,
        })),
      )
      .returning();
    cohort = users.map((u) => u.id);

    const gameRows = await testApp.db
      .insert(schema.games)
      .values(
        [1, 2, 3].map((n) => ({
          name: `Cohort Game ${n}`,
          slug: `cohort-game-${n}`,
        })),
      )
      .returning();
    games = gameRows.map((g) => g.id);

    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Cohort lineup',
        status: 'voting',
        visibility: 'public',
        createdBy: adminId,
        publicSlug: 'cohortslug1',
      })
      .returning();
    lineupId = lineup.id;

    // Engaged set = union(nominators, voters). u1/u2/u3 nominate one game
    // each; all three vote for game 1, so the union is exactly the 3 users.
    await testApp.db.insert(schema.communityLineupEntries).values(
      games.map((gameId, i) => ({
        lineupId,
        gameId,
        nominatedBy: cohort[i],
      })),
    );
    await testApp.db.insert(schema.communityLineupVotes).values(
      cohort.map((userId) => ({ lineupId, userId, gameId: games[0] })),
    );
  });

  it('writes a decided row + one match row per match-tier game on voting->decided', async () => {
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided', decidedGameId: games[0] })
      .expect(200);

    const rows = await memoryRows();
    const sig = buildCohortSignature(cohort);
    expect(sig).not.toBeNull();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.participantHash).toBe(sig?.participantHash);
      expect(row.cohortSize).toBe(3);
      expect(row.participantIds).toEqual(sig?.participantIds);
      expect(row.sourceLineupId).toBe(lineupId);
    }

    const decided = rows.filter((r) => r.resolution === 'decided');
    expect(decided).toHaveLength(1);
    expect(decided[0].gameId).toBe(games[0]);

    const matches = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.lineupId, lineupId));
    const matchMemory = rows.filter((r) => r.resolution === 'match');
    expect(matchMemory.map((r) => r.gameId).sort()).toEqual(
      matches.map((m) => m.gameId).sort(),
    );
    expect(matchMemory.length).toBeGreaterThan(0);
  });

  it('writes veto_won for the survivor and veto_lost per vetoed game', async () => {
    const [tb] = await testApp.db
      .insert(schema.communityLineupTiebreakers)
      .values({
        lineupId,
        mode: 'veto',
        status: 'active',
        tiedGameIds: [games[1], games[2]],
        originalVoteCount: 3,
      })
      .returning();

    await resolveTiebreaker(testApp.db, tb.id, games[1]);

    const rows = await memoryRows();
    const won = rows.filter((r) => r.resolution === 'veto_won');
    const lost = rows.filter((r) => r.resolution === 'veto_lost');
    expect(won).toHaveLength(1);
    expect(won[0].gameId).toBe(games[1]);
    expect(lost).toHaveLength(1);
    expect(lost[0].gameId).toBe(games[2]);
    expect(won[0].participantHash).toBe(
      buildCohortSignature(cohort)?.participantHash,
    );
  });

  it('is idempotent: replaying both triggers inserts zero additional rows', async () => {
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided', decidedGameId: games[0] })
      .expect(200);
    const [tb] = await testApp.db
      .insert(schema.communityLineupTiebreakers)
      .values({
        lineupId,
        mode: 'veto',
        status: 'active',
        tiedGameIds: [games[1], games[2]],
        originalVoteCount: 3,
      })
      .returning();
    await resolveTiebreaker(testApp.db, tb.id, games[1]);

    const before = (await memoryRows()).length;
    expect(before).toBeGreaterThan(0);

    // Replay BOTH triggers against the same lineup/tiebreaker.
    await writeDecidedCohortMemory(testApp.db, lineupId);
    await resolveTiebreaker(testApp.db, tb.id, games[1]);

    expect((await memoryRows()).length).toBe(before);
  });

  it('writes nothing for a lineup with zero nominators AND zero voters', async () => {
    const [empty] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Empty cohort',
        status: 'voting',
        visibility: 'public',
        createdBy: adminId,
        publicSlug: 'cohortslug2',
        decidedGameId: games[0],
      })
      .returning();

    await writeDecidedCohortMemory(testApp.db, empty.id);

    const rows = await testApp.db
      .select()
      .from(schema.communityLineupCohortMemory)
      .where(
        and(eq(schema.communityLineupCohortMemory.sourceLineupId, empty.id)),
      );
    expect(rows).toHaveLength(0);
  });
}

describe('Cohort memory write triggers (integration)', describeCohortMemoryWrites);
