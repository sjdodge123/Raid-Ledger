/**
 * ROK-1474 (A17) — `POST /lineups/:id/star`, end to end against a real DB.
 *
 * The two things only a real database can prove: the star is an ORDINAL on
 * the voter's own approval row (AC2 — there is no boolean and no second
 * table), and an OPEN ballot discloses no star counts to anybody (operator
 * ruling 2026-09-05: stars are private until the outcome).
 *
 * REGRESSION RECIPE: revert `setStar` to a plain insert and "starring an
 * unapproved game" fails on `myVotes`; revert the `rank: null` stub in
 * `lineups-response-star.helpers.ts` to a live count and the privacy case
 * fails with `Received: 1` — never by timeout.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';

type Response = { status: number; body: unknown };
type Detail = {
  myVotes: number[];
  myTopPickGameId: number | null;
  decisionReason: string | null;
  entries: { gameId: number; starCount: number | null }[];
};

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

/** A fixture step that fails loudly names ITSELF — never a downstream timeout. */
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
        name: `Star Game ${i + 1}`,
        slug: `star-game-${i + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      })
      .returning();
    games.push(game);
  }
  return games;
}

function star(token: string, lineupId: number, gameId: number | null) {
  return testApp.request
    .post(`/lineups/${lineupId}/star`)
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
}

function vote(token: string, lineupId: number, gameId: number) {
  return testApp.request
    .post(`/lineups/${lineupId}/vote`)
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
}

async function readDetail(token: string, lineupId: number): Promise<Detail> {
  const res = await testApp.request
    .get(`/lineups/${lineupId}`)
    .set('Authorization', `Bearer ${token}`);
  expectOk(res, 'read lineup detail');
  return res.body as Detail;
}

type TimelineEntry = {
  action: string;
  actor: { id: number } | null;
  metadata: Record<string, unknown> | null;
};

/** The any-authenticated timeline any other voter can read. */
async function readActivity(
  token: string,
  lineupId: number,
): Promise<TimelineEntry[]> {
  const res = await testApp.request
    .get(`/lineups/${lineupId}/activity`)
    .set('Authorization', `Bearer ${token}`);
  expectOk(res, 'read lineup activity');
  return (res.body as { data: TimelineEntry[] }).data;
}

/** Every vote row this voter holds, with its ordinal. */
function readVoteRows(lineupId: number, userId: number) {
  return testApp.db
    .select({
      gameId: schema.communityLineupVotes.gameId,
      rank: schema.communityLineupVotes.rank,
    })
    .from(schema.communityLineupVotes)
    .where(
      and(
        eq(schema.communityLineupVotes.lineupId, lineupId),
        eq(schema.communityLineupVotes.userId, userId),
      ),
    );
}

/** A private lineup in `voting`, two games nominated, one extra member. */
async function arrangeVotingLineup(votesPerPlayer = 2) {
  const voter = await createMemberAndLogin(
    testApp,
    'star-v1',
    'star-v1@test.local',
  );
  const created = await testApp.request
    .post('/lineups')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'Star Test',
      visibility: 'private',
      inviteeUserIds: [voter.userId],
      votesPerPlayer,
    });
  expectOk(created, 'create lineup');
  const lineupId = (created.body as { id: number }).id;
  const [a, b] = await createGames(2);
  for (const g of [a, b]) {
    expectOk(
      await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: g.id }),
      `nominate ${g.id}`,
    );
  }
  expectOk(
    await testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'voting' }),
    'advance to voting',
  );
  return { lineupId, gameA: a.id, gameB: b.id, voter };
}

describe('POST /lineups/:id/star', () => {
  it('starring an unapproved game creates the approval it implies (AC1)', async () => {
    const { lineupId, gameA, voter } = await arrangeVotingLineup();

    expectOk(await star(voter.token, lineupId, gameA), 'star game A');

    const detail = await readDetail(voter.token, lineupId);
    expect(detail.myVotes).toContain(gameA);
    expect(detail.myTopPickGameId).toBe(gameA);
  });

  it('stores the star as ordinal 1 on the vote row, never as a flag (AC2)', async () => {
    const { lineupId, gameA, voter } = await arrangeVotingLineup();
    expectOk(await vote(voter.token, lineupId, gameA), 'approve game A');

    expectOk(await star(voter.token, lineupId, gameA), 'star game A');

    expect(await readVoteRows(lineupId, voter.userId)).toEqual([
      { gameId: gameA, rank: 1 },
    ]);
  });

  it('moving the star leaves exactly one ranked row (AC2)', async () => {
    const { lineupId, gameA, gameB, voter } = await arrangeVotingLineup();
    expectOk(await star(voter.token, lineupId, gameA), 'star game A');

    expectOk(await star(voter.token, lineupId, gameB), 'star game B');

    const rows = await readVoteRows(lineupId, voter.userId);
    expect(rows.filter((r) => r.rank === 1)).toEqual([
      { gameId: gameB, rank: 1 },
    ]);
    // The old star keeps its approval — only the ordinal moved.
    expect(rows.map((r) => r.gameId).sort()).toEqual([gameA, gameB].sort());
  });

  it('a voter may star nothing — null clears the pick (AC1)', async () => {
    const { lineupId, gameA, voter } = await arrangeVotingLineup();
    expectOk(await star(voter.token, lineupId, gameA), 'star game A');

    expectOk(await star(voter.token, lineupId, null), 'clear star');

    const detail = await readDetail(voter.token, lineupId);
    expect(detail.myTopPickGameId).toBeNull();
    // Clearing the star is not un-voting.
    expect(detail.myVotes).toContain(gameA);
  });

  it('un-approving a starred game clears the star with it (Q5)', async () => {
    const { lineupId, gameA, voter } = await arrangeVotingLineup();
    expectOk(await star(voter.token, lineupId, gameA), 'star game A');

    expectOk(await vote(voter.token, lineupId, gameA), 'toggle the vote off');

    const detail = await readDetail(voter.token, lineupId);
    expect(detail.myVotes).not.toContain(gameA);
    expect(detail.myTopPickGameId).toBeNull();
  });

  it('a star that would exceed the vote cap is rejected like any vote (Q2)', async () => {
    const { lineupId, gameA, gameB, voter } = await arrangeVotingLineup(1);
    expectOk(await vote(voter.token, lineupId, gameA), 'approve game A');

    const res = await star(voter.token, lineupId, gameB);

    expect(res.status).toBe(400);
    // The rejected star must not have disturbed the existing approval.
    expect(await readVoteRows(lineupId, voter.userId)).toEqual([
      { gameId: gameA, rank: null },
    ]);
  });

  it('rejects a star for a game this lineup never nominated', async () => {
    const { lineupId, voter } = await arrangeVotingLineup();
    const [outsider] = await createGames(1);

    const res = await star(voter.token, lineupId, outsider.id);

    expect(res.status).toBe(400);
    // The crafted body must leave NO vote row behind: `countVotesPerGame`
    // groups over these rows, so one would have counted toward `detectTies`.
    expect(await readVoteRows(lineupId, voter.userId)).toEqual([]);
  });

  it('starring a game already approved does not consume another vote (Q2)', async () => {
    const { lineupId, gameA, voter } = await arrangeVotingLineup(1);
    expectOk(await vote(voter.token, lineupId, gameA), 'approve game A');

    expectOk(await star(voter.token, lineupId, gameA), 'star the same game');

    expect(await readVoteRows(lineupId, voter.userId)).toEqual([
      { gameId: gameA, rank: 1 },
    ]);
  });
});

describe('an open ballot discloses no star counts (operator ruling)', () => {
  it('every entry reports starCount null while voting, to the starrer too', async () => {
    const { lineupId, gameA, voter } = await arrangeVotingLineup();
    expectOk(await star(voter.token, lineupId, gameA), 'star game A');

    const mine = await readDetail(voter.token, lineupId);

    expect(mine.entries.map((e) => e.starCount)).toEqual([null, null]);
    expect(mine.decisionReason).toBeNull();
    // The voter still sees their OWN pick — that is the only disclosure.
    expect(mine.myTopPickGameId).toBe(gameA);
  });

  it('another voter learns neither the counts nor whose pick it was', async () => {
    const { lineupId, gameA, voter } = await arrangeVotingLineup();
    expectOk(await star(voter.token, lineupId, gameA), 'star game A');

    const theirs = await readDetail(adminToken, lineupId);

    expect(theirs.entries.map((e) => e.starCount)).toEqual([null, null]);
    expect(theirs.myTopPickGameId).toBeNull();
  });
  // The timeline is the SECOND door on the same room: `GET /lineups/:id/activity`
  // carries only the class-level jwt guard and returns `actor` plus the raw
  // `metadata` for every row, so a logged star was attributed and live.
  it('the activity timeline names no star and carries no starred gameId', async () => {
    const { lineupId, gameA, voter } = await arrangeVotingLineup();
    expectOk(await star(voter.token, lineupId, gameA), 'star game A');

    const timeline = await readActivity(adminToken, lineupId);

    expect(
      timeline.map((e) => e.action).filter((a) => a.includes('star')),
    ).toEqual([]);
    const leaked = timeline.filter(
      (e) => e.metadata?.gameId === gameA && e.actor?.id === voter.userId,
    );
    expect(leaked.map((e) => e.action)).toEqual([]);
  });

  it('clearing a star leaves the timeline silent too', async () => {
    const { lineupId, gameA, voter } = await arrangeVotingLineup();
    expectOk(await star(voter.token, lineupId, gameA), 'star game A');
    expectOk(await star(voter.token, lineupId, null), 'clear the star');

    const actions = (await readActivity(adminToken, lineupId)).map(
      (e) => e.action,
    );

    expect(actions.filter((a) => a.includes('star'))).toEqual([]);
  });
});
