/**
 * ROK-1752 — tiebreaker bracket-vote / veto authorization (integration).
 *
 * Before the fix `castBracketVote` inserted `{ matchupId: dto.matchupId }`
 * with no check that the matchup belonged to the path lineup's tiebreaker or
 * its current round, and neither bracket-vote nor veto ran the private-lineup
 * participation gate. Cases:
 *   1. A matchupId from ANOTHER lineup's bracket → 404, never counted.
 *   2. A matchup from an already-resolved round → 400, never counted.
 *   3. A gameId that is not in the matchup → 400.
 *   4. Uninvited member on a PRIVATE lineup → 403 on bracket-vote.
 *   5. Uninvited member on a PRIVATE lineup → 403 on veto, slot not spent.
 *   (4 and 5 also prove an invited member still votes / vetoes.)
 *   6. Admin bypass on a PRIVATE lineup they did not create still votes.
 *   7. A bye matchup → 400; a missing lineup → 404.
 *   8. A veto against a BRACKET-mode tiebreaker → 400, no veto row.
 *   9. The conditional insert writes nothing once the matchup is resolved
 *      (late-vote race: the round advanced after the pre-check).
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { TiebreakerService } from './tiebreaker.service';
import { advanceBracket } from './tiebreaker-bracket.helpers';
import { insertBracketVoteIfOpen } from './tiebreaker-authz.helpers';
import { findMatchups } from './tiebreaker-query.helpers';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { at, defined, nonEmpty } from '../../common/testing/narrow';

interface TiedSetup {
  lineupId: number;
  tiebreakerId: number;
  gameIds: number[];
}

interface SetupOpts {
  visibility: 'public' | 'private';
  mode: 'bracket' | 'veto';
  games: number;
  inviteeIds?: number[];
  createdBy?: number;
}

const BV = schema.communityLineupTiebreakerBracketVotes;
const VETO = schema.communityLineupTiebreakerVetoes;

function describeTiebreakerAuthz() {
  let testApp: TestApp;
  let adminToken: string;
  let service: TiebreakerService;
  let sendEmbedSpy: jest.SpyInstance;
  let seq = 0;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    service = testApp.app.get(TiebreakerService);
  });

  beforeEach(() => {
    sendEmbedSpy = jest
      .spyOn(testApp.app.get(DiscordBotClientService), 'sendEmbed')
      .mockResolvedValue({ id: 'mock-msg-tb-authz' } as never);
  });

  afterEach(async () => {
    sendEmbedSpy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  /** A member with local credentials, logged in for a bearer token. */
  async function createMember(): Promise<{ id: number; token: string }> {
    seq += 1;
    const email = `tb-authz-${seq}@test.local`;
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('Pass1Pass1!', 4);
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:${email}`,
          username: `tb-authz-${seq}`,
          role: 'member',
        })
        .returning(),
      'user',
    );
    await testApp.db
      .insert(schema.localCredentials)
      .values({ email, passwordHash: hash, userId: user.id });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'Pass1Pass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  async function createGame(): Promise<number> {
    seq += 1;
    const [g] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({
          name: `TBAuthz${seq}`,
          slug: `tb-authz-${seq}-${Date.now()}`,
        })
        .returning(),
      'game',
    );
    return g.id;
  }

  /** Voting lineup with `games` tied games (one vote each), tiebreaker started. */
  async function setupTiedLineup(opts: SetupOpts): Promise<TiedSetup> {
    const [lineup] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineups)
        .values({
          title: 'ROK-1752 tiebreaker authz',
          status: 'voting',
          visibility: opts.visibility,
          createdBy: opts.createdBy ?? testApp.seed.adminUser.id,
          publicSlug: generatePublicSlug(),
        })
        .returning(),
      'lineup',
    );
    const gameIds: number[] = [];
    for (let i = 0; i < opts.games; i++) {
      const voter = await createMember();
      const gameId = await createGame();
      gameIds.push(gameId);
      await testApp.db.insert(schema.communityLineupEntries).values({
        lineupId: lineup.id,
        gameId,
        nominatedBy: voter.id,
      });
      await testApp.db
        .insert(schema.communityLineupVotes)
        .values({ lineupId: lineup.id, gameId, userId: voter.id });
    }
    for (const userId of opts.inviteeIds ?? []) {
      await testApp.db
        .insert(schema.communityLineupInvitees)
        .values({ lineupId: lineup.id, userId });
    }
    const detail = await service.start(
      lineup.id,
      { mode: opts.mode, roundDurationHours: 24 },
      { id: testApp.seed.adminUser.id, role: 'admin' },
    );
    return { lineupId: lineup.id, tiebreakerId: detail.id, gameIds };
  }

  async function firstOpenMatchup(tiebreakerId: number) {
    const all = await findMatchups(testApp.db, tiebreakerId);
    const open = all.filter((m) => !m.isBye && !m.winnerGameId);
    return at(open, 0);
  }

  async function bracketVotesFor(matchupId: number) {
    return testApp.db.select().from(BV).where(eq(BV.matchupId, matchupId));
  }

  async function vetoesFor(tiebreakerId: number) {
    return testApp.db
      .select()
      .from(VETO)
      .where(eq(VETO.tiebreakerId, tiebreakerId));
  }

  function postBracketVote(
    lineupId: number,
    token: string,
    body: { matchupId: number; gameId: number },
  ) {
    return testApp.request
      .post(`/lineups/${lineupId}/tiebreaker/bracket-vote`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function postVeto(lineupId: number, token: string, gameId: number) {
    return testApp.request
      .post(`/lineups/${lineupId}/tiebreaker/veto`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId });
  }

  it('rejects a matchupId from another lineup bracket and never counts it', async () => {
    const own = await setupTiedLineup({
      visibility: 'public',
      mode: 'bracket',
      games: 2,
    });
    const foreign = await setupTiedLineup({
      visibility: 'public',
      mode: 'bracket',
      games: 2,
    });
    const foreignMatchup = await firstOpenMatchup(foreign.tiebreakerId);
    const res = await postBracketVote(own.lineupId, adminToken, {
      matchupId: foreignMatchup.id,
      gameId: foreignMatchup.gameAId,
    });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Matchup not found in this tiebreaker');
    expect(await bracketVotesFor(foreignMatchup.id)).toEqual([]);
  });

  it('rejects a matchup from an already-resolved round', async () => {
    const tb = await setupTiedLineup({
      visibility: 'public',
      mode: 'bracket',
      games: 4,
    });
    const roundOne = await firstOpenMatchup(tb.tiebreakerId);
    await advanceBracket(testApp.db, tb.tiebreakerId);
    const res = await postBracketVote(tb.lineupId, adminToken, {
      matchupId: roundOne.id,
      gameId: roundOne.gameAId,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Matchup is not open in the current round');
    expect(await bracketVotesFor(roundOne.id)).toEqual([]);
  });

  it('rejects a gameId that is not in the matchup', async () => {
    const tb = await setupTiedLineup({
      visibility: 'public',
      mode: 'bracket',
      games: 4,
    });
    const matchup = await firstOpenMatchup(tb.tiebreakerId);
    const outsider = defined(
      tb.gameIds.find((g) => g !== matchup.gameAId && g !== matchup.gameBId),
      'a game outside the first matchup',
    );
    const res = await postBracketVote(tb.lineupId, adminToken, {
      matchupId: matchup.id,
      gameId: outsider,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Game is not in this matchup');
    expect(await bracketVotesFor(matchup.id)).toEqual([]);
  });

  it('403s an uninvited member on a private lineup bracket-vote', async () => {
    const invited = await createMember();
    const outsider = await createMember();
    const tb = await setupTiedLineup({
      visibility: 'private',
      mode: 'bracket',
      games: 2,
      inviteeIds: [invited.id],
    });
    const matchup = await firstOpenMatchup(tb.tiebreakerId);
    const res = await postBracketVote(tb.lineupId, outsider.token, {
      matchupId: matchup.id,
      gameId: matchup.gameAId,
    });
    expect(res.status).toBe(403);
    expect(await bracketVotesFor(matchup.id)).toEqual([]);

    const ok = await postBracketVote(tb.lineupId, invited.token, {
      matchupId: matchup.id,
      gameId: matchup.gameAId,
    });
    expect(ok.status).toBe(200);
    const rows = await bracketVotesFor(matchup.id);
    expect(rows.map((r) => r.userId)).toEqual([invited.id]);
  });

  it('403s an uninvited member on a private lineup veto without spending the slot', async () => {
    const invited = await createMember();
    const outsider = await createMember();
    const tb = await setupTiedLineup({
      visibility: 'private',
      mode: 'veto',
      games: 2,
      inviteeIds: [invited.id],
    });
    const res = await postVeto(tb.lineupId, outsider.token, at(tb.gameIds, 0));
    expect(res.status).toBe(403);
    expect(await vetoesFor(tb.tiebreakerId)).toEqual([]);

    const ok = await postVeto(tb.lineupId, invited.token, at(tb.gameIds, 0));
    expect(ok.status).toBe(200);
    const [row] = await testApp.db
      .select()
      .from(VETO)
      .where(
        and(
          eq(VETO.tiebreakerId, tb.tiebreakerId),
          eq(VETO.userId, invited.id),
        ),
      );
    expect(row?.gameId).toBe(at(tb.gameIds, 0));
  });

  it('lets an admin vote on a private lineup they were not invited to', async () => {
    const creator = await createMember();
    const tb = await setupTiedLineup({
      visibility: 'private',
      mode: 'bracket',
      games: 2,
      createdBy: creator.id,
    });
    const matchup = await firstOpenMatchup(tb.tiebreakerId);
    const res = await postBracketVote(tb.lineupId, adminToken, {
      matchupId: matchup.id,
      gameId: matchup.gameAId,
    });
    expect(res.status).toBe(200);
    const rows = await bracketVotesFor(matchup.id);
    expect(rows.map((r) => r.userId)).toEqual([testApp.seed.adminUser.id]);
  });

  it('rejects a vote on a bye matchup', async () => {
    const tb = await setupTiedLineup({
      visibility: 'public',
      mode: 'bracket',
      games: 3,
    });
    const all = await findMatchups(testApp.db, tb.tiebreakerId);
    const bye = defined(
      all.find((m) => m.isBye),
      'a bye matchup in a 3-game bracket',
    );
    const res = await postBracketVote(tb.lineupId, adminToken, {
      matchupId: bye.id,
      gameId: bye.gameAId,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Matchup is not open in the current round');
    expect(await bracketVotesFor(bye.id)).toEqual([]);
  });

  it('404s a bracket-vote and a veto on a missing lineup', async () => {
    const vote = await postBracketVote(999999, adminToken, {
      matchupId: 1,
      gameId: 1,
    });
    expect(vote.status).toBe(404);
    expect(vote.body.message).toBe('Lineup not found');
    const veto = await postVeto(999999, adminToken, 1);
    expect(veto.status).toBe(404);
    expect(veto.body.message).toBe('Lineup not found');
  });

  it('rejects a veto against a bracket-mode tiebreaker', async () => {
    const tb = await setupTiedLineup({
      visibility: 'public',
      mode: 'bracket',
      games: 2,
    });
    const res = await postVeto(tb.lineupId, adminToken, at(tb.gameIds, 0));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Not a veto tiebreaker');
    expect(await vetoesFor(tb.tiebreakerId)).toEqual([]);
  });

  it('writes no vote once the matchup was resolved after the pre-check', async () => {
    const tb = await setupTiedLineup({
      visibility: 'public',
      mode: 'bracket',
      games: 4,
    });
    const roundOne = await firstOpenMatchup(tb.tiebreakerId);
    await advanceBracket(testApp.db, tb.tiebreakerId);
    const inserted = await insertBracketVoteIfOpen(testApp.db, {
      tiebreakerId: tb.tiebreakerId,
      matchupId: roundOne.id,
      userId: testApp.seed.adminUser.id,
      gameId: roundOne.gameAId,
    });
    expect(inserted).toBe(false);
    expect(await bracketVotesFor(roundOne.id)).toEqual([]);
  });
}

describe(
  'ROK-1752 tiebreaker bracket-vote / veto authorization (integration)',
  describeTiebreakerAuthz,
);
