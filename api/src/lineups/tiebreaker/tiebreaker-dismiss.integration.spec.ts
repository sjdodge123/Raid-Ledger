/**
 * ROK-1262 — Tiebreaker dismiss idempotency (integration).
 *
 * Regression: `POST /lineups/:id/tiebreaker/dismiss` used to 404 when no
 * tiebreaker row existed, but the TiebreakerPromptModal opens precisely in
 * that "ties detected, no row yet" state. The dismiss endpoint is now
 * idempotent and transitions to `decided` with the lowest-gameId tied entry.
 *
 * Cases:
 *   1. Pending/active tiebreaker exists → 200, row dismissed, lineup decided
 *      (regression of existing happy path).
 *   2. No tiebreaker row, voting + ties → 200, lineup `decided`, `decidedGameId`
 *      = min gameId of tied set (NEW — the bug).
 *   3. No tiebreaker row, voting, no ties → 400 'No ties to dismiss'.
 *   4. Lineup not in voting → 400 from `findAndValidateLineup`.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { TiebreakerService } from './tiebreaker.service';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';

interface TiedLineupSetup {
  lineupId: number;
  gameAId: number;
  gameBId: number;
  voterAId: number;
  voterBId: number;
}

function describeTiebreakerDismiss() {
  let testApp: TestApp;
  let adminToken: string;
  let tiebreakerService: TiebreakerService;
  let sendEmbedSpy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    tiebreakerService = testApp.app.get(TiebreakerService);
  });

  beforeEach(() => {
    // start() fires a notification dispatch in the regression case; stub the
    // bot client so we don't depend on Discord being reachable.
    sendEmbedSpy = jest
      .spyOn(testApp.app.get(DiscordBotClientService), 'sendEmbed')
      .mockResolvedValue({ id: 'mock-msg-tb-dismiss' } as never);
  });

  afterEach(async () => {
    sendEmbedSpy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  async function createMember(tag: string): Promise<number> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:dismiss-${tag}`,
        username: `mem-dismiss-${tag}`,
        role: 'member',
      })
      .returning();
    return user.id;
  }

  async function createGame(name: string): Promise<number> {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: `${name.toLowerCase()}-${Date.now()}-${Math.random()}`,
      })
      .returning();
    return g.id;
  }

  /** Voting lineup with two tied games (one vote each from distinct voters). */
  async function setupVotingLineupWithTies(): Promise<TiedLineupSetup> {
    const voterAId = await createMember('vA');
    const voterBId = await createMember('vB');
    const gameAId = await createGame('TBDismissA');
    const gameBId = await createGame('TBDismissB');

    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'ROK-1262 dismiss',
        status: 'voting',
        visibility: 'public',
        createdBy: testApp.seed.adminUser.id,
        publicSlug: generatePublicSlug(),
      })
      .returning();

    await testApp.db.insert(schema.communityLineupEntries).values([
      { lineupId: lineup.id, gameId: gameAId, nominatedBy: voterAId },
      { lineupId: lineup.id, gameId: gameBId, nominatedBy: voterBId },
    ]);
    await testApp.db.insert(schema.communityLineupVotes).values([
      { lineupId: lineup.id, gameId: gameAId, userId: voterAId },
      { lineupId: lineup.id, gameId: gameBId, userId: voterBId },
    ]);

    return { lineupId: lineup.id, gameAId, gameBId, voterAId, voterBId };
  }

  async function getLineup(lineupId: number) {
    const [row] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId))
      .limit(1);
    return row;
  }

  // ── Case 1: regression of existing path ──────────────────────────────

  it('dismisses when a pending/active tiebreaker row exists (regression)', async () => {
    const { lineupId } = await setupVotingLineupWithTies();
    await tiebreakerService.start(lineupId, {
      mode: 'veto',
      roundDurationHours: 24,
    });

    const res = await testApp.request
      .post(`/lineups/${lineupId}/tiebreaker/dismiss`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const [tb] = await testApp.db
      .select()
      .from(schema.communityLineupTiebreakers)
      .where(eq(schema.communityLineupTiebreakers.lineupId, lineupId));
    expect(tb.status).toBe('dismissed');
    const lineup = await getLineup(lineupId);
    expect(lineup.status).toBe('decided');
    expect(lineup.activeTiebreakerId).toBeNull();
  });

  // ── Case 2: the bug — no row, ties present ───────────────────────────

  it('dismisses with no tiebreaker row + ties → 200, decidedGameId = min tied gameId (ROK-1262)', async () => {
    const { lineupId, gameAId, gameBId } = await setupVotingLineupWithTies();
    // Sanity: no tiebreaker row yet — this is the exact state the modal opens in.
    const tbsBefore = await testApp.db
      .select()
      .from(schema.communityLineupTiebreakers)
      .where(eq(schema.communityLineupTiebreakers.lineupId, lineupId));
    expect(tbsBefore).toHaveLength(0);

    const res = await testApp.request
      .post(`/lineups/${lineupId}/tiebreaker/dismiss`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const lineup = await getLineup(lineupId);
    expect(lineup.status).toBe('decided');
    expect(lineup.decidedGameId).toBe(Math.min(gameAId, gameBId));
  });

  // ── Case 3: no row + no ties → clear 400 ─────────────────────────────

  it('returns 400 when voting lineup has no ties to dismiss', async () => {
    const voterId = await createMember('soloVoter');
    const gameId = await createGame('TBDismissSolo');
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'ROK-1262 no-ties',
        status: 'voting',
        visibility: 'public',
        createdBy: testApp.seed.adminUser.id,
        publicSlug: generatePublicSlug(),
      })
      .returning();
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId: lineup.id,
      gameId,
      nominatedBy: voterId,
    });
    await testApp.db.insert(schema.communityLineupVotes).values({
      lineupId: lineup.id,
      gameId,
      userId: voterId,
    });

    const res = await testApp.request
      .post(`/lineups/${lineup.id}/tiebreaker/dismiss`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/no ties/i);
  });

  // ── Case 4: not voting → 400 ─────────────────────────────────────────

  it('returns 400 when lineup is not in voting status', async () => {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'ROK-1262 not-voting',
        status: 'building',
        visibility: 'public',
        createdBy: testApp.seed.adminUser.id,
        publicSlug: generatePublicSlug(),
      })
      .returning();

    const res = await testApp.request
      .post(`/lineups/${lineup.id}/tiebreaker/dismiss`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/voting/i);
  });
}

describe(
  'Regression: ROK-1262 dismiss with no tiebreaker row (integration)',
  describeTiebreakerDismiss,
);
