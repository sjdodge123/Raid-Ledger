/**
 * ROK-1457 — lineup → LFG bridge against a real DB + the in-memory Redis.
 *
 * T-1 is THE GUARD: a full `→ decided` transition through
 * `runStatusTransition` (via `LineupsService.transitionStatus`) writes ZERO
 * `lfg_intents` rows. It is an absence assertion, so it also asserts that a
 * bridge notification WAS created — a path that never runs cannot pass it.
 *
 * The transition emits `lineup.decided` fire-and-forget; every test drains
 * the handler by awaiting the promise its spy captured, never by sleeping.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';
import { LineupsService } from '../lineups/lineups.service';
import { LineupsGateway } from '../lineups/lineups.gateway';
import { LineupNotificationService } from '../lineups/lineup-notification.service';
import { DiscordNotificationService } from '../notifications/discord-notification.service';
import { LineupLfgBridgeService } from '../notifications/lineup-lfg-bridge.service';
import {
  banUser,
  createGame,
  deactivateUser,
} from './lfg.integration.spec-helpers';
import { LFG_EXPIRY_DAYS } from './lfg.constants';
import {
  LFG_BRIDGE_PAYLOAD_KIND,
  bridgeDedupKey,
  findBridgeCandidates,
} from './lfg-bridge.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A type alias (not an interface) so it satisfies `db.execute<T>()`'s
 * `Record<string, unknown>` constraint. */
type BridgeNotificationRow = {
  user_id: number;
  type: string;
  payload: {
    kind: string;
    lineupId: number;
    lineupTitle: string;
    games: { gameId: number; gameName: string; gameSlug: string }[];
    link: string;
  };
};

describe('Lineup → LFG bridge (ROK-1457, integration)', () => {
  let testApp: TestApp;
  let lineups: LineupsService;
  let bridge: LineupLfgBridgeService;
  let discordDispatch: jest.SpyInstance;
  let redis: {
    keys: (pattern: string) => Promise<string[]>;
    del: (...keys: string[]) => Promise<number>;
  };
  let seq = 0;

  // ── fixtures ────────────────────────────────────────────────────────────

  async function createUser(tag: string): Promise<number> {
    seq += 1;
    const [user] = await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${tag}-${seq}`, username: `${tag}-${seq}` })
      .returning();
    return user.id;
  }

  async function createLineup(title = 'Friday Night'): Promise<number> {
    seq += 1;
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title,
        status: 'voting',
        createdBy: testApp.seed.adminUser.id,
        publicSlug: `br${Date.now().toString(36)}${seq}`.slice(0, 16),
      })
      .returning();
    return lineup.id;
  }

  async function nominate(
    lineupId: number,
    gameId: number,
    nominatedBy: number,
  ): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupEntries)
      .values({ lineupId, gameId, nominatedBy });
  }

  /** Full `voting → decided` transition, then drain the bridge handler. */
  async function decide(lineupId: number, decidedGameId: number) {
    const handler = jest.spyOn(bridge, 'handleLineupDecided');
    await lineups.transitionStatus(lineupId, {
      status: 'decided',
      decidedGameId,
    });
    expect(handler).toHaveBeenCalledWith({ lineupId });
    await Promise.all(handler.mock.results.map((r) => r.value as unknown));
    handler.mockRestore();
  }

  async function activeIntent(userId: number, gameId: number): Promise<number> {
    const [row] = await testApp.db
      .insert(schema.lfgIntents)
      .values({
        userId,
        gameId,
        status: 'active',
        visibility: 'local',
        expiresAt: new Date(Date.now() + LFG_EXPIRY_DAYS * DAY_MS),
      })
      .returning();
    return row.id;
  }

  // ── readers ─────────────────────────────────────────────────────────────

  async function countIntents(): Promise<number> {
    const rows = await testApp.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM lfg_intents`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async function bridgeNotifications(
    userId?: number,
  ): Promise<BridgeNotificationRow[]> {
    return testApp.db.execute<BridgeNotificationRow>(sql`
      SELECT user_id, type, payload FROM notifications
      WHERE payload->>'kind' = ${LFG_BRIDGE_PAYLOAD_KIND}
        ${userId === undefined ? sql`` : sql`AND user_id = ${userId}`}
      ORDER BY id
    `);
  }

  async function dedupKeys(): Promise<string[]> {
    const rows = await testApp.db.execute<{ dedup_key: string }>(sql`
      SELECT dedup_key FROM notification_dedup
      WHERE dedup_key LIKE 'lfg-bridge:%' ORDER BY dedup_key
    `);
    return rows.map((r) => r.dedup_key);
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  beforeAll(async () => {
    testApp = await getTestApp();
    lineups = testApp.app.get(LineupsService);
    bridge = testApp.app.get(LineupLfgBridgeService);
    redis = testApp.app.get(REDIS_CLIENT);
  });

  beforeEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    const keys = await redis.keys('lfg-bridge:*');
    if (keys.length > 0) await redis.del(...keys);
    // The decided channel embed and the gateway need a bot / socket server
    // this app has none of; both are fire-and-forget and not under test.
    jest
      .spyOn(testApp.app.get(LineupNotificationService), 'notifyMatchesFound')
      .mockResolvedValue(undefined);
    jest
      .spyOn(testApp.app.get(LineupsGateway), 'emitStatusChange')
      .mockImplementation(() => undefined);
    discordDispatch = jest
      .spyOn(testApp.app.get(DiscordNotificationService), 'dispatch')
      .mockResolvedValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── T-1: THE GUARD ──────────────────────────────────────────────────────

  it('T-1 GUARD: a full → decided transition writes ZERO lfg_intents rows while offering LFG to 2 nominators', async () => {
    const [u1, u2, u3] = await Promise.all([
      createUser('u1'),
      createUser('u2'),
      createUser('u3'),
    ]);
    const winner = await createGame(testApp, 'Winner');
    const l1 = await createGame(testApp, 'Loser One');
    const l2 = await createGame(testApp, 'Loser Two');
    const lineupId = await createLineup();
    await nominate(lineupId, winner.id, u3);
    await nominate(lineupId, l1.id, u1);
    await nominate(lineupId, l2.id, u2);
    const intentsBefore = await countIntents();

    await decide(lineupId, winner.id);

    const offered = await bridgeNotifications();
    // Not vacuous: the path DID run and DID notify both losing nominators.
    expect(offered.map((n) => n.user_id).sort()).toEqual([u1, u2].sort());
    expect({
      intentRowsWrittenByClosePath: (await countIntents()) - intentsBefore,
    }).toEqual({ intentRowsWrittenByClosePath: 0 });
  });

  // ── T-2 / T-3 / T-3b: qualification + one notification per user ────────

  it('T-2/T-3: notifies losing nominators only, in-app only, with the decided-page link and all their games', async () => {
    const u1 = await createUser('u1');
    const u3 = await createUser('u3');
    const winner = await createGame(testApp, 'Winner');
    const l1 = await createGame(testApp, 'Loser One');
    const l2 = await createGame(testApp, 'Loser Two');
    const lineupId = await createLineup('Saturday Sesh');
    await nominate(lineupId, winner.id, u3);
    await nominate(lineupId, l1.id, u1);
    await nominate(lineupId, l2.id, u1);

    await decide(lineupId, winner.id);

    expect(await bridgeNotifications(u3)).toEqual([]);
    const [row, ...extra] = await bridgeNotifications(u1);
    expect(extra).toEqual([]);
    expect(row.type).toBe('community_lineup');
    expect(row.payload).toMatchObject({
      lineupId,
      lineupTitle: 'Saturday Sesh',
      link: `/lineups/${lineupId}`,
    });
    expect(row.payload.games.map((g) => g.gameName).sort()).toEqual([
      'Loser One',
      'Loser Two',
    ]);
    // T-3b: delivery restraint — no Discord DM leaves this path (D3).
    expect(discordDispatch).not.toHaveBeenCalled();
  });

  it('T-2 (selector): flipping the winner to L1 drops u1 and adds u3', async () => {
    const u1 = await createUser('u1');
    const u3 = await createUser('u3');
    const winner = await createGame(testApp, 'Winner');
    const l1 = await createGame(testApp, 'Loser One');
    const lineupId = await createLineup();
    await nominate(lineupId, winner.id, u3);
    await nominate(lineupId, l1.id, u1);
    await decide(lineupId, winner.id);
    const now = new Date();

    const before = await findBridgeCandidates(testApp.db, lineupId, now);
    expect(before.map((c) => [c.userId, c.gameId])).toEqual([[u1, l1.id]]);

    await testApp.db
      .update(schema.communityLineups)
      .set({ decidedGameId: l1.id })
      .where(eq(schema.communityLineups.id, lineupId));

    const after = await findBridgeCandidates(testApp.db, lineupId, now);
    expect(after.map((c) => [c.userId, c.gameId])).toEqual([[u3, winner.id]]);
  });

  // ── T-4: one-shot per (user, game, LINEUP) ──────────────────────────────

  it('T-4: the same (user, game) losing on a SECOND lineup IS re-prompted; a repeat close of the SAME lineup is not', async () => {
    const u = await createUser('u');
    const other = await createUser('other');
    const g = await createGame(testApp, 'Perennial Loser');

    async function closeWith(winnerName: string): Promise<number> {
      const winner = await createGame(testApp, winnerName);
      const lineupId = await createLineup();
      await nominate(lineupId, winner.id, other);
      await nominate(lineupId, g.id, u);
      await decide(lineupId, winner.id);
      return lineupId;
    }

    const first = await closeWith('Winner A');
    expect((await bridgeNotifications(u)).length).toBe(1);
    expect(await dedupKeys()).toEqual([bridgeDedupKey(u, g.id, first)]);

    // Losing AGAIN in a different lineup is new information, so it re-offers.
    const second = await closeWith('Winner B');
    expect({
      bridgeNotificationsForUser: (await bridgeNotifications(u)).length,
    }).toEqual({ bridgeNotificationsForUser: 2 });
    expect(await dedupKeys()).toEqual(
      [bridgeDedupKey(u, g.id, first), bridgeDedupKey(u, g.id, second)].sort(),
    );

    // What the 30-day TTL now guards: a repeat DECIDED emit for the SAME
    // lineup (reversion re-decides) offers nothing a second time.
    await bridge.handleLineupDecided({ lineupId: second });
    expect({
      bridgeNotificationsForUser: (await bridgeNotifications(u)).length,
    }).toEqual({ bridgeNotificationsForUser: 2 });
  });

  // ── T-5: active intent ⇒ skipped entirely ───────────────────────────────

  it('T-5: a nominator holding a live intent on the game gets no notification and NO dedup claim; an expired intent qualifies again', async () => {
    const u1 = await createUser('u1');
    const other = await createUser('other');
    const winner = await createGame(testApp, 'Winner');
    const l1 = await createGame(testApp, 'Loser One');
    const intentId = await activeIntent(u1, l1.id);
    const lineupId = await createLineup();
    await nominate(lineupId, winner.id, other);
    await nominate(lineupId, l1.id, u1);

    await decide(lineupId, winner.id);

    expect(await bridgeNotifications(u1)).toEqual([]);
    expect(await dedupKeys()).toEqual([]);

    await testApp.db
      .update(schema.lfgIntents)
      .set({ expiresAt: new Date(Date.now() - DAY_MS) })
      .where(eq(schema.lfgIntents.id, intentId));
    const second = await createLineup();
    await nominate(second, winner.id, other);
    await nominate(second, l1.id, u1);
    await decide(second, winner.id);

    expect((await bridgeNotifications(u1)).length).toBe(1);
    expect(await dedupKeys()).toEqual([bridgeDedupKey(u1, l1.id, second)]);
  });

  // ── T-6: deactivated / banned nominators are never prompted ─────────────

  it('T-6: deactivated ⇒ skipped, banned ⇒ skipped, both cleared ⇒ notified', async () => {
    const u1 = await createUser('u1');
    const other = await createUser('other');
    const winner = await createGame(testApp, 'Winner');
    const l1 = await createGame(testApp, 'Loser One');
    const lineupId = await createLineup();
    await nominate(lineupId, winner.id, other);
    await nominate(lineupId, l1.id, u1);
    const now = new Date();

    await deactivateUser(testApp, u1);
    await decide(lineupId, winner.id);
    expect(await bridgeNotifications(u1)).toEqual([]);

    await testApp.db.execute(
      sql`UPDATE users SET deactivated_at = NULL WHERE id = ${u1}`,
    );
    await banUser(testApp, u1);
    expect(await findBridgeCandidates(testApp.db, lineupId, now)).toEqual([]);

    await testApp.db.execute(
      sql`UPDATE users SET banned_at = NULL WHERE id = ${u1}`,
    );
    const cleared = await findBridgeCandidates(testApp.db, lineupId, now);
    expect(cleared.map((c) => [c.userId, c.gameId])).toEqual([[u1, l1.id]]);
    await bridge.handleLineupDecided({ lineupId });
    expect((await bridgeNotifications(u1)).length).toBe(1);
  });

  // ── T-7: batch per user ─────────────────────────────────────────────────

  it('T-7: three losing nominations by one user → ONE notification naming 3 games and THREE dedup claims', async () => {
    const u = await createUser('u');
    const other = await createUser('other');
    const winner = await createGame(testApp, 'Winner');
    const losers = await Promise.all(
      ['Alpha', 'Bravo', 'Charlie'].map((n) => createGame(testApp, n)),
    );
    const lineupId = await createLineup();
    await nominate(lineupId, winner.id, other);
    for (const g of losers) await nominate(lineupId, g.id, u);

    await decide(lineupId, winner.id);

    const rows = await bridgeNotifications(u);
    expect({ notificationsForUser: rows.length }).toEqual({
      notificationsForUser: 1,
    });
    expect(rows[0].payload.games.map((g) => g.gameName)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(await dedupKeys()).toEqual(
      losers.map((g) => bridgeDedupKey(u, g.id, lineupId)).sort(),
    );
  });

  // ── D9: the page read is caller-scoped and self-heals ───────────────────

  it("GET /lfg/bridge/:lineupId returns only the caller's open offers and drops a game once they raise a hand", async () => {
    const adminId = testApp.seed.adminUser.id;
    const token = await loginAsAdmin(testApp.request, testApp.seed);
    const other = await createUser('other');
    const winner = await createGame(testApp, 'Winner');
    const mine = await createGame(testApp, 'Mine');
    const theirs = await createGame(testApp, 'Theirs');
    const lineupId = await createLineup('Bridge Night');
    await nominate(lineupId, winner.id, other);
    await nominate(lineupId, theirs.id, other);
    await nominate(lineupId, mine.id, adminId);
    await decide(lineupId, winner.id);

    const res = await testApp.request
      .get(`/lfg/bridge/${lineupId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        gameId: mine.id,
        gameName: 'Mine',
        gameSlug: mine.slug,
        gameCoverUrl: null,
        lineupId,
        lineupTitle: 'Bridge Night',
      },
    ]);

    await activeIntent(adminId, mine.id);
    const healed = await testApp.request
      .get(`/lfg/bridge/${lineupId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(healed.body).toEqual([]);

    const anon = await testApp.request.get(`/lfg/bridge/${lineupId}`);
    expect(anon.status).toBe(401);
  });
});
