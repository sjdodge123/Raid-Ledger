/**
 * ROK-1474 (A18) — the star resolving (or failing to resolve) an approval tie.
 *
 * Drives the REAL transition guard (`PATCH /lineups/:id/status` with no
 * `decidedGameId`), which is the same choke point the deadline job runs
 * through. Four ballots, four different facts about a group:
 *
 *   1. stars break the tie          → decided, with its reasoning stated
 *   2. stars tie                    → the ROK-1374 hold, payload unchanged
 *   3. nobody starred (legacy)      → the ROK-1374 hold, payload unchanged
 *   4. some starred, some did not   → the unstarred approvals still count
 *
 * REGRESSION RECIPE: revert D6 (the resolve in `guardTiebreakerOnTransition`)
 * and case 1 fails on `status` with `Received: "voting"`; delete the D8
 * all-zero guard in `resolveTieFromStarCounts` and case 3 fails on
 * `status` with `Received: "decided"` — never by timeout.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';

type Response = { status: number; body: unknown };
type LineupRow = typeof schema.communityLineups.$inferSelect;
type Voter = { userId: number; token: string };

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

function expectOk(res: Response, step: string): void {
  if (res.status >= 300) {
    throw new Error(
      `fixture step "${step}" failed: HTTP ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

async function createGames(count: number) {
  const games: (typeof schema.games.$inferSelect)[] = [];
  for (let i = 0; i < count; i++) {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: `Tiebreak Game ${i + 1}`,
        slug: `tb-game-${i + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      })
      .returning();
    games.push(game);
  }
  return games;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function vote(token: string, lineupId: number, gameId: number) {
  return testApp.request
    .post(`/lineups/${lineupId}/vote`)
    .set(auth(token))
    .send({ gameId });
}

function star(token: string, lineupId: number, gameId: number) {
  return testApp.request
    .post(`/lineups/${lineupId}/star`)
    .set(auth(token))
    .send({ gameId });
}

/** The operator transition with NO named winner — the guard decides. */
function decide(lineupId: number) {
  return testApp.request
    .patch(`/lineups/${lineupId}/status`)
    .set(auth(adminToken))
    .send({ status: 'decided' });
}

async function readLineup(lineupId: number): Promise<LineupRow> {
  const [row] = await testApp.db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId));
  if (!row) throw new Error(`lineup ${lineupId} vanished`);
  return row;
}

/**
 * A private lineup in `voting` with `count` extra members, two nominated
 * games, and every member approving BOTH — a dead-level approval tie.
 */
async function arrangeLevelTie(count: number) {
  const voters: Voter[] = [];
  for (let i = 0; i < count; i++) {
    voters.push(
      await createMemberAndLogin(
        testApp,
        `tb-v${i}`,
        `tb-v${i}-${Date.now()}@test.local`,
      ),
    );
  }
  const created = await testApp.request
    .post('/lineups')
    .set(auth(adminToken))
    .send({
      title: 'Star Tiebreak',
      visibility: 'private',
      inviteeUserIds: voters.map((v) => v.userId),
      votesPerPlayer: 2,
    });
  expectOk(created, 'create lineup');
  const lineupId = (created.body as { id: number }).id;
  const [a, b] = await createGames(2);
  for (const g of [a, b]) {
    expectOk(
      await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set(auth(adminToken))
        .send({ gameId: g.id }),
      `nominate ${g.id}`,
    );
  }
  expectOk(
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set(auth(adminToken))
      .send({ status: 'voting' }),
    'advance to voting',
  );
  for (const v of voters) {
    expectOk(await vote(v.token, lineupId, a.id), 'approve A');
    expectOk(await vote(v.token, lineupId, b.id), 'approve B');
  }
  return { lineupId, gameA: a.id, gameB: b.id, voters };
}

describe('an approval tie that the top picks can break', () => {
  it('decides the starred game and states its own reasoning (AC3)', async () => {
    const { lineupId, gameA, gameB, voters } = await arrangeLevelTie(3);
    expectOk(await star(voters[0].token, lineupId, gameA), 'v0 stars A');
    expectOk(await star(voters[1].token, lineupId, gameA), 'v1 stars A');
    expectOk(await star(voters[2].token, lineupId, gameB), 'v2 stars B');

    const res = await decide(lineupId);

    expectOk(res, 'transition to decided');
    const row = await readLineup(lineupId);
    expect(row.status).toBe('decided');
    expect(row.decidedGameId).toBe(gameA);
    expect(row.tieDetectedAt).toBeNull();
  });

  it('publishes the reasoning on the decided detail response (AC3/D10)', async () => {
    const { lineupId, gameA, voters } = await arrangeLevelTie(3);
    expectOk(await star(voters[0].token, lineupId, gameA), 'v0 stars A');
    expectOk(await star(voters[1].token, lineupId, gameA), 'v1 stars A');
    expectOk(await decide(lineupId), 'transition to decided');

    const res = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set(auth(adminToken));

    expectOk(res, 'read decided detail');
    const body = res.body as {
      decisionReason: string | null;
      entries: { gameId: number; starCount: number | null }[];
    };
    expect(body.decisionReason).toBe('tied on votes 3–3, won on top picks 2–0');
    // The outcome discloses the counts the open ballot withheld.
    expect(body.entries.find((e) => e.gameId === gameA)?.starCount).toBe(2);
  });

  it('counts the unstarred voters approvals but not their picks (AC7)', async () => {
    // Four voters approve both games; only two of them star. The approval
    // tally must stay 4–4 (a mixed ballot is not a partial ballot) while the
    // star tally reads 2–0.
    const { lineupId, gameA, voters } = await arrangeLevelTie(4);
    expectOk(await star(voters[0].token, lineupId, gameA), 'v0 stars A');
    expectOk(await star(voters[1].token, lineupId, gameA), 'v1 stars A');

    expectOk(await decide(lineupId), 'transition to decided');

    const res = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set(auth(adminToken));
    const body = res.body as {
      decisionReason: string | null;
      entries: { gameId: number; voteCount: number }[];
    };
    expect(body.entries.map((e) => e.voteCount)).toEqual([4, 4]);
    expect(body.decisionReason).toBe('tied on votes 4–4, won on top picks 2–0');
  });
});

describe('an approval tie the top picks cannot break falls through (AC4/AC6)', () => {
  it('level stars leave ROK-1374s payload byte-identical', async () => {
    const { lineupId, gameA, gameB, voters } = await arrangeLevelTie(2);
    expectOk(await star(voters[0].token, lineupId, gameA), 'v0 stars A');
    expectOk(await star(voters[1].token, lineupId, gameB), 'v1 stars B');

    const res = await decide(lineupId);

    expect(res.status).toBe(400);
    // The guard throws `BadRequestException({ message, tiedGameIds, voteCount })`
    // and Nest sends that object as the body itself — the FLAT shape
    // `readTieFromTransitionError` reads (`tie-hold.helpers.ts`).
    const body = res.body as {
      message: string;
      tiedGameIds: number[];
      voteCount: number;
    };
    expect(body.message).toBe('TIEBREAKER_REQUIRED');
    expect([...body.tiedGameIds].sort()).toEqual([gameA, gameB].sort());
    expect(body.voteCount).toBe(2);
    expect((await readLineup(lineupId)).status).toBe('voting');
  });

  it('a legacy ballot with no stars resolves exactly as it does today (AC6)', async () => {
    const { lineupId, gameA, gameB } = await arrangeLevelTie(2);

    const res = await decide(lineupId);

    expect(res.status).toBe(400);
    // The guard throws `BadRequestException({ message, tiedGameIds, voteCount })`
    // and Nest sends that object as the body itself — the FLAT shape
    // `readTieFromTransitionError` reads (`tie-hold.helpers.ts`).
    const body = res.body as {
      message: string;
      tiedGameIds: number[];
      voteCount: number;
    };
    expect(body.message).toBe('TIEBREAKER_REQUIRED');
    expect([...body.tiedGameIds].sort()).toEqual([gameA, gameB].sort());
    const row = await readLineup(lineupId);
    expect(row.status).toBe('voting');
    expect(row.decidedGameId).toBeNull();
  });
});

describe('the readiness card reports the stars the group already cast (D11)', () => {
  it("marks a star-tied hold and names each game's count", async () => {
    const { lineupId, gameA, gameB, voters } = await arrangeLevelTie(2);
    expectOk(await star(voters[0].token, lineupId, gameA), 'v0 stars A');
    expectOk(await star(voters[1].token, lineupId, gameB), 'v1 stars B');
    // The transition refuses (stars are level), which is what opens the hold
    // in production. The hold row is written directly here so the card can be
    // read without driving the phase processor — this file is about the star
    // information ON the card, not about how ROK-1374 opens it.
    expect((await decide(lineupId)).status).toBe(400);
    await testApp.db
      .update(schema.communityLineups)
      .set({
        tieDetectedAt: new Date(),
        tieGameIds: [gameA, gameB],
        tieVoteCount: 2,
      })
      .where(eq(schema.communityLineups.id, lineupId));

    const res = await testApp.request
      .get(`/lineups/${lineupId}/tie-readiness`)
      .set(auth(adminToken));

    expectOk(res, 'read the readiness card');
    const card = res.body as {
      starTied: boolean;
      games: { gameId: number; starCount: number }[];
    };
    expect(card.starTied).toBe(true);
    expect(card.games.map((g) => [g.gameId, g.starCount]).sort()).toEqual(
      [
        [gameA, 1],
        [gameB, 1],
      ].sort(),
    );
  });

  it('a legacy no-star hold is not reported as a star tie (Q6)', async () => {
    const { lineupId, gameA, gameB } = await arrangeLevelTie(2);
    expect((await decide(lineupId)).status).toBe(400);
    await testApp.db
      .update(schema.communityLineups)
      .set({
        tieDetectedAt: new Date(),
        tieGameIds: [gameA, gameB],
        tieVoteCount: 2,
      })
      .where(eq(schema.communityLineups.id, lineupId));

    const res = await testApp.request
      .get(`/lineups/${lineupId}/tie-readiness`)
      .set(auth(adminToken));

    expectOk(res, 'read the readiness card');
    const card = res.body as {
      starTied: boolean;
      games: { starCount: number }[];
    };
    expect(card.starTied).toBe(false);
    expect(card.games.map((g) => g.starCount)).toEqual([0, 0]);
  });
});
