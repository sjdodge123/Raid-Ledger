/**
 * Tiebreaker bracket vote is atomic with its round advance + finalize
 * (overnight backlog triage 2026-11-09, found in the ROK-2098 review).
 *
 * Before the fix `castBracketVote` committed the vote on the outer pool and
 * only THEN took the round-advance lock (`advanceRoundIfComplete`) and, in a
 * second transaction, finalized. A busy lock (409) or a failing matching
 * pass therefore errored the caller while their vote stayed stored — and on
 * a bracket-completing vote the advance had committed too, so the retry hit
 * a closed matchup (400) and the lineup was stranded in `voting`.
 *
 * Now the vote, the advance and the finalize share ONE locked transaction:
 *   1. lock busy → 409 and the vote is NOT stored;
 *   2. matching throws → the vote, the advance and the resolve all roll
 *      back, and a retry of the same vote completes the lineup;
 *   3. success path unchanged: a non-final vote is stored, round still open.
 */
import { ConflictException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import * as matching from '../lineups-matching.helpers';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { at, defined, nonEmpty } from '../../common/testing/narrow';
import { TiebreakerService } from './tiebreaker.service';
import { TIEBREAKER_ADVANCE_LOCK_CLASS } from './tiebreaker-advance.helpers';
import { findMatchups } from './tiebreaker-query.helpers';

const BV = schema.communityLineupTiebreakerBracketVotes;

interface Tied {
  lineupId: number;
  tiebreakerId: number;
  voterIds: number[];
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function describeVoteAtomic() {
  let testApp: TestApp;
  let service: TiebreakerService;
  let sendEmbedSpy: jest.SpyInstance;
  let seq = 0;

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(TiebreakerService);
  });

  beforeEach(() => {
    sendEmbedSpy = jest
      .spyOn(testApp.app.get(DiscordBotClientService), 'sendEmbed')
      .mockResolvedValue({ id: 'mock-msg-tb-atomic' } as never);
  });

  afterEach(async () => {
    sendEmbedSpy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function createVoterWithGame(lineupId: number): Promise<number[]> {
    seq += 1;
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:tb-atomic-${seq}@test.local`,
          username: `tb-atomic-${seq}`,
          role: 'member',
        })
        .returning(),
      'user',
    );
    const [game] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: `TBAtomic${seq}`, slug: `tb-atomic-${seq}-${Date.now()}` })
        .returning(),
      'game',
    );
    const row = { lineupId, gameId: game.id };
    await testApp.db
      .insert(schema.communityLineupEntries)
      .values({ ...row, nominatedBy: user.id });
    await testApp.db
      .insert(schema.communityLineupVotes)
      .values({ ...row, userId: user.id });
    return [user.id, game.id];
  }

  /** Public voting lineup, two tied games, bracket tiebreaker started. */
  async function setupTied(): Promise<Tied> {
    const [lineup] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineups)
        .values({
          title: 'tiebreaker vote atomic',
          status: 'voting',
          visibility: 'public',
          createdBy: testApp.seed.adminUser.id,
          publicSlug: generatePublicSlug(),
        })
        .returning(),
      'lineup',
    );
    const voterIds: number[] = [];
    for (let i = 0; i < 2; i++) {
      const [userId] = await createVoterWithGame(lineup.id);
      voterIds.push(defined(userId, 'voter id'));
    }
    const detail = await service.start(
      lineup.id,
      { mode: 'bracket', roundDurationHours: 24 },
      { id: testApp.seed.adminUser.id, role: 'admin' },
    );
    return { lineupId: lineup.id, tiebreakerId: detail.id, voterIds };
  }

  async function onlyMatchup(tiebreakerId: number) {
    const open = (await findMatchups(testApp.db, tiebreakerId)).filter(
      (m) => !m.isBye,
    );
    expect(open).toHaveLength(1);
    return at(open, 0);
  }

  function vote(tb: Tied, voterIdx: number, m: { id: number; gameAId: number }) {
    const id = defined(tb.voterIds[voterIdx], 'voter');
    return service.castBracketVote(
      tb.lineupId,
      { matchupId: m.id, gameId: m.gameAId },
      { id, role: 'member' },
    );
  }

  async function votesFor(matchupId: number) {
    return testApp.db.select().from(BV).where(eq(BV.matchupId, matchupId));
  }

  async function statusOf(tb: Tied) {
    const T = schema.communityLineupTiebreakers;
    const L = schema.communityLineups;
    const [t] = await testApp.db.select().from(T).where(eq(T.id, tb.tiebreakerId));
    const [l] = await testApp.db.select().from(L).where(eq(L.id, tb.lineupId));
    return { tiebreaker: t?.status, lineup: l?.status };
  }

  /** Hold the tiebreaker's round-advance lock on another connection. */
  async function holdAdvanceLock(tiebreakerId: number) {
    const held = deferred();
    const release = deferred();
    const holder = testApp.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${TIEBREAKER_ADVANCE_LOCK_CLASS}::int4, ${tiebreakerId}::int4)`,
      );
      held.resolve();
      await release.promise;
    });
    await held.promise;
    return { release: release.resolve, done: holder };
  }

  it('a vote refused because the advance lock is busy is not stored', async () => {
    const tb = await setupTied();
    const m = await onlyMatchup(tb.tiebreakerId);
    const lock = await holdAdvanceLock(tb.tiebreakerId);
    try {
      await expect(vote(tb, 0, m)).rejects.toBeInstanceOf(ConflictException);
    } finally {
      lock.release();
      await lock.done;
    }
    // Old code: the vote committed before the lock wait timed out.
    expect(await votesFor(m.id)).toHaveLength(0);
  }, 20_000);

  it('a failing finalize rolls the completing vote back and a retry decides the lineup', async () => {
    const tb = await setupTied();
    const m = await onlyMatchup(tb.tiebreakerId);
    await vote(tb, 0, m);
    const buildSpy = jest
      .spyOn(matching, 'buildMatchesForLineup')
      .mockRejectedValueOnce(new Error('matching exploded'));
    try {
      await expect(vote(tb, 1, m)).rejects.toThrow('matching exploded');
      // Old code: this vote and the matchup winner had already committed.
      expect(await votesFor(m.id)).toHaveLength(1);
      expect((await onlyMatchup(tb.tiebreakerId)).winnerGameId).toBeNull();
      expect(await statusOf(tb)).toEqual({ tiebreaker: 'active', lineup: 'voting' });
      // Old code: the retry 400s on the now-closed matchup.
      await vote(tb, 1, m);
    } finally {
      buildSpy.mockRestore();
    }
    expect(await votesFor(m.id)).toHaveLength(2);
    expect(await statusOf(tb)).toEqual({ tiebreaker: 'resolved', lineup: 'decided' });
  });

  it('a non-final vote is stored and leaves the round open', async () => {
    const tb = await setupTied();
    const m = await onlyMatchup(tb.tiebreakerId);
    const detail = await vote(tb, 0, m);
    expect(detail.id).toBe(tb.tiebreakerId);
    expect(await votesFor(m.id)).toHaveLength(1);
    expect((await onlyMatchup(tb.tiebreakerId)).winnerGameId).toBeNull();
    expect(await statusOf(tb)).toEqual({ tiebreaker: 'active', lineup: 'voting' });
  });
}

describe('tiebreaker bracket vote is atomic with advance + finalize (integration)', describeVoteAtomic);
