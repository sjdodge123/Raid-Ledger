/**
 * `GET /lineups/:id/cohort-memory` integration tests (ROK-1309 S4, real DB).
 *
 * The exact scenario the AC spells out:
 *   1. 3 users nominate + vote on lineup A -> one game decided, one tiebreaker
 *      resolved (1 `veto_won`, 1 `veto_lost`). Lineup B with the SAME 3 users
 *      returns the decided + veto_won games and NOT the veto_lost one.
 *   2. Those 3 users + 1 extra -> empty (no superset match).
 *   3. A 2-user subset -> empty (no subset match).
 *   4. A lineup whose engaged set is empty -> empty, HTTP 200, never a 500.
 *   5. Cohort membership is order-independent — building the engaged set in a
 *      different insertion order still matches.
 */
import type { CohortMemoryResponseDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { resolveTiebreaker } from './tiebreaker/tiebreaker-lifecycle.helpers';

/** Create a bare `voting` lineup and return its id. */
async function createLineup(
  testApp: TestApp,
  adminId: number,
  title: string,
  slug: string,
): Promise<number> {
  const [lineup] = await testApp.db
    .insert(schema.communityLineups)
    .values({
      title,
      status: 'voting',
      visibility: 'public',
      createdBy: adminId,
      publicSlug: slug,
    })
    .returning();
  return lineup.id;
}

/**
 * Give a lineup an engaged participant set: one nomination per user plus one
 * vote per user. `userIds` order IS the insertion order, which case 5 varies
 * deliberately.
 */
async function engage(
  testApp: TestApp,
  lineupId: number,
  userIds: number[],
  gameIds: number[],
): Promise<void> {
  for (const [i, userId] of userIds.entries()) {
    await testApp.db
      .insert(schema.communityLineupEntries)
      .values({ lineupId, gameId: gameIds[i], nominatedBy: userId });
    await testApp.db
      .insert(schema.communityLineupVotes)
      .values({ lineupId, userId, gameId: gameIds[0] });
  }
}

function describeCohortMemoryEndpoint() {
  let testApp: TestApp;
  let adminToken: string;
  let adminId: number;
  let cohort: number[];
  let outsider: number;
  let gameIds: number[];
  let lineupA: number;

  /** GET the endpoint and hand back a typed body (supertest gives `any`). */
  const fetchMemory = async (
    lineupId: number,
  ): Promise<CohortMemoryResponseDto> => {
    const res = await testApp.request
      .get(`/lineups/${lineupId}/cohort-memory`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return res.body as CohortMemoryResponseDto;
  };

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
        [1, 2, 3, 4].map((n) => ({
          discordId: `memory-${n}`,
          username: `memory${n}`,
          role: 'member' as const,
        })),
      )
      .returning();
    cohort = users.slice(0, 3).map((u) => u.id);
    outsider = users[3].id;

    const gameRows = await testApp.db
      .insert(schema.games)
      .values(
        [1, 2, 3, 4].map((n) => ({
          name: `Memory Game ${n}`,
          slug: `memory-game-${n}`,
          coverUrl: n === 1 ? 'https://img.example/1.jpg' : null,
        })),
      )
      .returning();
    gameIds = gameRows.map((g) => g.id);

    // Lineup A is the source of the memory: games[0] is decided, and a veto
    // tiebreaker between games[1] and games[2] leaves games[1] standing.
    lineupA = await createLineup(testApp, adminId, 'Lineup A', 'memslug1');
    await engage(testApp, lineupA, cohort, gameIds);
    await testApp.request
      .patch(`/lineups/${lineupA}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'decided', decidedGameId: gameIds[0] })
      .expect(200);
    const [tb] = await testApp.db
      .insert(schema.communityLineupTiebreakers)
      .values({
        lineupId: lineupA,
        mode: 'veto',
        status: 'active',
        tiedGameIds: [gameIds[1], gameIds[2]],
        originalVoteCount: 3,
      })
      .returning();
    await resolveTiebreaker(testApp.db, tb.id, gameIds[1]);
  });

  it('returns decided + veto_won games for the same cohort, never veto_lost', async () => {
    const lineupB = await createLineup(
      testApp,
      adminId,
      'Lineup B',
      'memslug2',
    );
    await engage(testApp, lineupB, cohort, gameIds);

    const body = await fetchMemory(lineupB);
    expect(body.cohortSize).toBe(3);

    const byGame = new Map(body.entries.map((e) => [e.gameId, e.resolution]));
    expect(byGame.get(gameIds[0])).toBe('decided');
    expect(byGame.get(gameIds[1])).toBe('veto_won');
    // games[2] was vetoed OUT — filtered at the API layer.
    expect(byGame.has(gameIds[2])).toBe(false);
    expect(
      body.entries.some((e) => (e.resolution as string) === 'veto_lost'),
    ).toBe(false);

    const decided = body.entries.find((e) => e.gameId === gameIds[0]);
    expect(decided?.gameName).toBe('Memory Game 1');
    expect(decided?.gameCoverUrl).toBe('https://img.example/1.jpg');
    // The memory was written by lineup A, not by the lineup being read.
    expect(decided?.sourceLineupId).toBe(lineupA);
    expect(Date.parse(decided?.lastResolvedAt ?? '')).not.toBeNaN();
  });

  it('returns empty for a superset cohort (same 3 plus one extra)', async () => {
    const lineupC = await createLineup(
      testApp,
      adminId,
      'Lineup C',
      'memslug3',
    );
    await engage(testApp, lineupC, [...cohort, outsider], gameIds);

    const body = await fetchMemory(lineupC);
    expect(body.cohortSize).toBe(4);
    expect(body.entries).toEqual([]);
  });

  it('returns empty for a subset cohort (2 of the 3)', async () => {
    const lineupD = await createLineup(
      testApp,
      adminId,
      'Lineup D',
      'memslug4',
    );
    await engage(testApp, lineupD, cohort.slice(0, 2), gameIds);

    const body = await fetchMemory(lineupD);
    expect(body.cohortSize).toBe(2);
    expect(body.entries).toEqual([]);
  });

  it('returns an empty payload (not a 500) when the engaged set is empty', async () => {
    const lineupE = await createLineup(
      testApp,
      adminId,
      'Lineup E',
      'memslug5',
    );

    const body = await fetchMemory(lineupE);
    expect(body).toEqual({ cohortSize: 0, entries: [] });
  });

  it('never hands a reverted lineup back its OWN just-decided games', async () => {
    // Operator revert: `decided -> voting` (VALID_REVERSIONS). The rows lineup
    // A wrote on its own decision are still there with source_lineup_id = A,
    // and A's cohort hash is unchanged — so without the self-exclusion the
    // page would offer A the very games it just decided as "played with this
    // group before".
    await testApp.request
      .patch(`/lineups/${lineupA}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'voting' })
      .expect(200);

    const body = await fetchMemory(lineupA);

    expect(body.cohortSize).toBe(3);
    expect(body.entries).toEqual([]);
  });

  it('matches order-independently — engaged set built in reverse order', async () => {
    const lineupF = await createLineup(
      testApp,
      adminId,
      'Lineup F',
      'memslug6',
    );
    await engage(testApp, lineupF, [...cohort].reverse(), gameIds);

    const body = await fetchMemory(lineupF);
    expect(body.cohortSize).toBe(3);
    expect(body.entries.map((e) => e.gameId).sort()).toEqual(
      [gameIds[0], gameIds[1]].sort(),
    );
  });
}

describe(
  'GET /lineups/:id/cohort-memory (integration)',
  describeCohortMemoryEndpoint,
);
