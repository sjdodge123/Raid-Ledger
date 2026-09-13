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
import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { resolveTiebreaker } from './tiebreaker/tiebreaker-lifecycle.helpers';
import {
  writeDecidedCohortMemory,
  writeTiebreakerCohortMemory,
} from './cohort-memory-write.helpers';
import { buildCohortSignature } from './cohort-memory-signature.helpers';

/** ROK-1538: the cohort is the ROSTER, so the creator is always a member. */
const rosterOf = (adminId: number, ...ids: number[]) => [adminId, ...ids];

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
    const seed = await truncateAllTables(testApp.db);
    adminId = seed.adminUser.id;
    adminToken = await loginAsAdmin(testApp.request, seed);

    const users = await testApp.db
      .insert(schema.users)
      .values(
        [1, 2, 3].map((n) => ({
          discordId: `cohort-${n}`,
          username: `cohort${n}`,
          role: 'member' as const,
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

    // Roster = {created_by} ∪ invitees ∪ nominators ∪ voters (ROK-1538).
    // u1/u2/u3 nominate one game each and all three vote for game 1, so the
    // roster is those 3 users PLUS the admin who created the lineup.
    await testApp.db.insert(schema.communityLineupEntries).values(
      games.map((gameId, i) => ({
        lineupId,
        gameId,
        nominatedBy: cohort[i],
      })),
    );
    await testApp.db
      .insert(schema.communityLineupVotes)
      .values(cohort.map((userId) => ({ lineupId, userId, gameId: games[0] })));
  });

  it('writes a decided row + one match row per match-tier game on voting->decided', async () => {
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided', decidedGameId: games[0] })
      .expect(200);

    const rows = await memoryRows();
    const sig = buildCohortSignature(rosterOf(adminId, ...cohort));
    expect(sig).not.toBeNull();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.participantHash).toBe(sig?.participantHash);
      expect(row.cohortSize).toBe(4);
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
      matches
        .filter((m) => m.thresholdMet)
        .map((m) => m.gameId)
        .sort(),
    );
    expect(matchMemory.length).toBeGreaterThan(0);
  });

  it('remembers MATCH-TIER games only, not every game that drew a vote', async () => {
    // `insertMatch` writes a community_lineup_matches row for EVERY game with
    // voteCount > 0 and records the tier separately in `threshold_met`. One of
    // three voters is 33% against the default 35% threshold, so games[1] gets
    // a match row that is NOT match-tier — and must not be remembered, or a
    // lineup where every nomination drew a single vote would badge them all
    // "Match".
    await testApp.db
      .insert(schema.communityLineupVotes)
      .values({ lineupId, userId: cohort[0], gameId: games[1] });

    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided', decidedGameId: games[0] })
      .expect(200);

    const matches = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.lineupId, lineupId));
    const belowTier = matches.filter((m) => !m.thresholdMet);
    expect(belowTier.map((m) => m.gameId)).toEqual([games[1]]);

    const remembered = (await memoryRows())
      .filter((r) => r.resolution === 'match')
      .map((r) => r.gameId);
    expect(remembered).toEqual([games[0]]);
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
      buildCohortSignature(rosterOf(adminId, ...cohort))?.participantHash,
    );
  });

  it('never writes a match row for a game that lost the tiebreaker', async () => {
    // ROK-1309 (Codex P2): a game can clear the match tier AND then lose the
    // veto the cohort ran over the tied set. The read path filters only rows
    // whose OWN resolution is `veto_lost`, so a surviving `match` row would
    // re-surface a rejected game badged "Match".
    await testApp.db
      .insert(schema.communityLineupVotes)
      .values(cohort.map((userId) => ({ lineupId, userId, gameId: games[1] })));

    const [tb] = await testApp.db
      .insert(schema.communityLineupTiebreakers)
      .values({
        lineupId,
        mode: 'veto',
        status: 'active',
        tiedGameIds: [games[0], games[1]],
        originalVoteCount: 3,
      })
      .returning();
    await resolveTiebreaker(testApp.db, tb.id, games[0]);

    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided', decidedGameId: games[0] })
      .expect(200);

    // Non-vacuity: the loser really IS match-tier, so the only thing keeping
    // it out of the memory table is the veto suppression.
    const matches = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.lineupId, lineupId));
    expect(matches.find((m) => m.gameId === games[1])?.thresholdMet).toBe(true);

    const rows = await memoryRows();
    expect(
      rows.filter((r) => r.gameId === games[1]).map((r) => r.resolution),
    ).toEqual(['veto_lost']);
    // The winner keeps everything it earned.
    expect(
      rows
        .filter((r) => r.gameId === games[0])
        .map((r) => r.resolution)
        .sort(),
    ).toEqual(['decided', 'match', 'veto_won']);
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

    // Replay BOTH triggers against the same lineup/tiebreaker. The logger spy
    // is load-bearing: the writers swallow errors so the transition can never
    // fail, which means a row-count assertion ALONE would still pass with the
    // `ON CONFLICT DO NOTHING` guard removed (verified — it did). Asserting
    // that nothing was logged is what makes this test non-vacuous.
    const logger = { error: jest.fn() } as unknown as Logger;
    await resolveTiebreaker(testApp.db, tb.id, games[1]);
    await writeDecidedCohortMemory(testApp.db, lineupId, logger);
    await writeTiebreakerCohortMemory(
      testApp.db,
      lineupId,
      tb.id,
      games[1],
      logger,
    );

    expect(logger.error).not.toHaveBeenCalled();
    expect((await memoryRows()).length).toBe(before);
  });

  it('remembers a lineup nobody engaged with, keyed on its creator-only roster (ROK-1538)', async () => {
    // Under the ROK-1309 engaged definition this lineup had NO signature and
    // wrote nothing. The roster definition gives it one immediately, which is
    // the whole point: a group's memory must exist before anyone clicks.
    const [quiet] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Nobody engaged',
        status: 'voting',
        visibility: 'public',
        createdBy: adminId,
        publicSlug: 'cohortslug2',
        decidedGameId: games[0],
      })
      .returning();

    await writeDecidedCohortMemory(testApp.db, quiet.id);

    const rows = await testApp.db
      .select()
      .from(schema.communityLineupCohortMemory)
      .where(eq(schema.communityLineupCohortMemory.sourceLineupId, quiet.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].participantIds).toEqual([adminId]);
    expect(rows[0].cohortSize).toBe(1);
    expect(rows[0].participantHash).toBe(
      buildCohortSignature([adminId])?.participantHash,
    );
  });

  it('writes the ROSTER set, including an invitee who never engaged (ROK-1538)', async () => {
    // The AC case: a private lineup where one member was invited but never
    // nominated and never voted. Under the engaged definition they vanished
    // from the key, so the same group of friends produced a different hash
    // depending on who happened to click.
    const [bystander] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'cohort-bystander',
        username: 'bystander',
        role: 'member' as const,
      })
      .returning();
    await testApp.db
      .insert(schema.communityLineupInvitees)
      .values({ lineupId, userId: bystander.id });

    await writeDecidedCohortMemory(testApp.db, lineupId);

    const rows = await memoryRows();
    expect(rows.length).toBeGreaterThan(0);
    const expected = buildCohortSignature([
      adminId,
      ...cohort,
      bystander.id,
    ]);
    for (const row of rows) {
      expect(row.participantIds).toEqual(expected?.participantIds);
      expect(row.participantHash).toBe(expected?.participantHash);
      expect(row.cohortSize).toBe(5);
    }
  });

  it('writes nothing for a lineup id that does not exist', async () => {
    // The only remaining empty-cohort case: no `created_by` to anchor on.
    await writeDecidedCohortMemory(testApp.db, 9_999_999);

    const rows = await testApp.db
      .select()
      .from(schema.communityLineupCohortMemory)
      .where(
        and(
          eq(schema.communityLineupCohortMemory.sourceLineupId, 9_999_999),
        ),
      );
    expect(rows).toHaveLength(0);
  });
}

describe(
  'Cohort memory write triggers (integration)',
  describeCohortMemoryWrites,
);
