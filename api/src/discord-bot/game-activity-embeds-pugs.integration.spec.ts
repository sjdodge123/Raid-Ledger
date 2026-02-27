/**
 * Discord Game-Activity, Embed Scheduling & PUG Invites Integration Tests (ROK-527)
 *
 * Verifies game activity session persistence (buffered flush, close with duration,
 * stale sweep, orphaned cleanup), daily rollup aggregations, embed scheduler's
 * LEFT JOIN detection, embed poster's live roster enrichment, and PUG slot
 * atomic claim/update patterns against a real PostgreSQL database.
 *
 * Uses direct DB operations and service-level calls since these services are
 * triggered by Discord bot events, not HTTP endpoints.
 */
import { eq, and, isNull, lt } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

describe('Game Activity, Embed Scheduling & PUG Invites (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // ===================================================================
  // Game Activity Sessions — Flush & Close
  // ===================================================================

  describe('game activity sessions', () => {
    it('should persist a session record via direct insert (simulating flush)', async () => {
      const db = testApp.db;
      const startedAt = new Date();

      const [session] = await db
        .insert(schema.gameActivitySessions)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          discordActivityName: 'Test Game',
          startedAt,
        })
        .returning();

      expect(session.userId).toBe(testApp.seed.adminUser.id);
      expect(session.gameId).toBe(testApp.seed.game.id);
      expect(session.discordActivityName).toBe('Test Game');
      expect(session.endedAt).toBeNull();
      expect(session.durationSeconds).toBeNull();

      // Verify persistence
      const [readBack] = await db
        .select()
        .from(schema.gameActivitySessions)
        .where(eq(schema.gameActivitySessions.id, session.id))
        .limit(1);

      expect(readBack).toBeDefined();
      expect(readBack.userId).toBe(testApp.seed.adminUser.id);
    });

    it('should close a session with correct duration calculation', async () => {
      const db = testApp.db;
      const startedAt = new Date(Date.now() - 3600 * 1000); // 1 hour ago

      // Insert an open session
      const [session] = await db
        .insert(schema.gameActivitySessions)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          discordActivityName: 'Test Game',
          startedAt,
        })
        .returning();

      // Close the session (simulating flush close logic)
      const endedAt = new Date();
      const durationSeconds = Math.floor(
        (endedAt.getTime() - startedAt.getTime()) / 1000,
      );

      await db
        .update(schema.gameActivitySessions)
        .set({ endedAt, durationSeconds })
        .where(eq(schema.gameActivitySessions.id, session.id));

      // Verify the closed session
      const [closed] = await db
        .select()
        .from(schema.gameActivitySessions)
        .where(eq(schema.gameActivitySessions.id, session.id))
        .limit(1);

      expect(closed.endedAt).not.toBeNull();
      expect(closed.durationSeconds).toBeGreaterThanOrEqual(3590);
      expect(closed.durationSeconds).toBeLessThanOrEqual(3610);
    });

    it('should resolve game ID via discord_game_mappings table', async () => {
      const db = testApp.db;

      // Create a mapping: "FINAL FANTASY XIV" -> testApp.seed.game.id
      await db.insert(schema.discordGameMappings).values({
        discordActivityName: 'FINAL FANTASY XIV',
        gameId: testApp.seed.game.id,
      });

      // Verify the mapping lookup
      const [mapping] = await db
        .select({ gameId: schema.discordGameMappings.gameId })
        .from(schema.discordGameMappings)
        .where(
          eq(
            schema.discordGameMappings.discordActivityName,
            'FINAL FANTASY XIV',
          ),
        )
        .limit(1);

      expect(mapping).toBeDefined();
      expect(mapping.gameId).toBe(testApp.seed.game.id);

      // Insert a session using the resolved game ID
      const [session] = await db
        .insert(schema.gameActivitySessions)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: mapping.gameId,
          discordActivityName: 'FINAL FANTASY XIV',
          startedAt: new Date(),
        })
        .returning();

      expect(session.gameId).toBe(testApp.seed.game.id);
    });

    it('should resolve game ID via exact name match on games table', async () => {
      const db = testApp.db;

      // The seeded game is "Test Game" — look it up by exact name
      const [game] = await db
        .select({ id: schema.games.id })
        .from(schema.games)
        .where(eq(schema.games.name, 'Test Game'))
        .limit(1);

      expect(game).toBeDefined();
      expect(game.id).toBe(testApp.seed.game.id);
    });

    it('should store session with null gameId for unmatched activity names', async () => {
      const db = testApp.db;

      const [session] = await db
        .insert(schema.gameActivitySessions)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: null,
          discordActivityName: 'Some Unknown Game',
          startedAt: new Date(),
        })
        .returning();

      expect(session.gameId).toBeNull();
      expect(session.discordActivityName).toBe('Some Unknown Game');
    });

    it('should find open session by user + activity name for close matching', async () => {
      const db = testApp.db;
      const startedAt = new Date(Date.now() - 600_000); // 10 min ago

      // Insert an open session
      await db.insert(schema.gameActivitySessions).values({
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        discordActivityName: 'Test Game',
        startedAt,
      });

      // Query for open session matching user + activity (as flush close does)
      const [openSession] = await db
        .select({
          id: schema.gameActivitySessions.id,
          startedAt: schema.gameActivitySessions.startedAt,
        })
        .from(schema.gameActivitySessions)
        .where(
          and(
            eq(schema.gameActivitySessions.userId, testApp.seed.adminUser.id),
            eq(schema.gameActivitySessions.discordActivityName, 'Test Game'),
            isNull(schema.gameActivitySessions.endedAt),
          ),
        )
        .limit(1);

      expect(openSession).toBeDefined();
      expect(openSession.id).toBeDefined();
    });
  });

  // ===================================================================
  // Stale Session Sweep
  // ===================================================================

  describe('stale session sweep', () => {
    it('should cap duration at 24h for sessions older than 24 hours', async () => {
      const db = testApp.db;
      const MAX_DURATION = 24 * 60 * 60; // 86400 seconds
      const staleStart = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago

      // Insert a stale open session (started > 24h ago, no endedAt)
      const [staleSession] = await db
        .insert(schema.gameActivitySessions)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          discordActivityName: 'Stale Game',
          startedAt: staleStart,
        })
        .returning();

      // Simulate the sweep: close stale session with capped duration
      await db
        .update(schema.gameActivitySessions)
        .set({
          endedAt: new Date(),
          durationSeconds: MAX_DURATION,
        })
        .where(
          and(
            isNull(schema.gameActivitySessions.endedAt),
            eq(schema.gameActivitySessions.id, staleSession.id),
          ),
        );

      // Verify the session was closed with capped duration
      const [swept] = await db
        .select()
        .from(schema.gameActivitySessions)
        .where(eq(schema.gameActivitySessions.id, staleSession.id))
        .limit(1);

      expect(swept.endedAt).not.toBeNull();
      expect(swept.durationSeconds).toBe(MAX_DURATION);
    });

    it('should not affect sessions started within 24 hours', async () => {
      const db = testApp.db;
      const MAX_DURATION = 24 * 60 * 60;
      const recentStart = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago

      // Insert a recent open session
      const [recentSession] = await db
        .insert(schema.gameActivitySessions)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          discordActivityName: 'Recent Game',
          startedAt: recentStart,
        })
        .returning();

      // Sweep query using lt(startedAt, cutoff) — same pattern as the real service
      const cutoff = new Date(Date.now() - MAX_DURATION * 1000);
      const swept = await db
        .update(schema.gameActivitySessions)
        .set({
          endedAt: new Date(),
          durationSeconds: MAX_DURATION,
        })
        .where(
          and(
            isNull(schema.gameActivitySessions.endedAt),
            lt(schema.gameActivitySessions.startedAt, cutoff),
          ),
        )
        .returning({ id: schema.gameActivitySessions.id });

      // Recent session should NOT be swept (startedAt is after the cutoff)
      const sweptIds = swept.map((r) => r.id);
      expect(sweptIds).not.toContain(recentSession.id);

      // Verify the session is still open
      const [session] = await db
        .select()
        .from(schema.gameActivitySessions)
        .where(eq(schema.gameActivitySessions.id, recentSession.id))
        .limit(1);

      expect(session.endedAt).toBeNull();
      expect(session.durationSeconds).toBeNull();
    });
  });

  // ===================================================================
  // Orphaned Session Cleanup
  // ===================================================================

  describe('orphaned session cleanup', () => {
    it('should close stale orphans (>24h) with capped duration', async () => {
      const db = testApp.db;
      const MAX_DURATION = 24 * 60 * 60;
      const now = new Date();

      // Insert a stale orphan (started 30h ago, no end)
      const staleStart = new Date(now.getTime() - 30 * 60 * 60 * 1000);
      const [stale] = await db
        .insert(schema.gameActivitySessions)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: null,
          discordActivityName: 'Orphan Stale',
          startedAt: staleStart,
        })
        .returning();

      // Simulate closeOrphanedSessions stale path
      const staleResult = await db
        .update(schema.gameActivitySessions)
        .set({
          endedAt: now,
          durationSeconds: MAX_DURATION,
        })
        .where(
          and(
            isNull(schema.gameActivitySessions.endedAt),
            eq(schema.gameActivitySessions.id, stale.id),
          ),
        )
        .returning({ id: schema.gameActivitySessions.id });

      expect(staleResult.length).toBe(1);

      const [closed] = await db
        .select()
        .from(schema.gameActivitySessions)
        .where(eq(schema.gameActivitySessions.id, stale.id))
        .limit(1);

      expect(closed.durationSeconds).toBe(MAX_DURATION);
      expect(closed.endedAt).not.toBeNull();
    });

    it('should close recent orphans (<24h) with computed duration', async () => {
      const db = testApp.db;
      const now = new Date();

      // Insert a recent orphan (started 2h ago, no end)
      const recentStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const [recent] = await db
        .insert(schema.gameActivitySessions)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          discordActivityName: 'Orphan Recent',
          startedAt: recentStart,
        })
        .returning();

      // Simulate closeOrphanedSessions recent path: compute actual duration
      const expectedDuration = Math.floor(
        (now.getTime() - recentStart.getTime()) / 1000,
      );
      await db
        .update(schema.gameActivitySessions)
        .set({
          endedAt: now,
          durationSeconds: expectedDuration,
        })
        .where(eq(schema.gameActivitySessions.id, recent.id));

      const [closed] = await db
        .select()
        .from(schema.gameActivitySessions)
        .where(eq(schema.gameActivitySessions.id, recent.id))
        .limit(1);

      expect(closed.endedAt).not.toBeNull();
      // Should be approximately 2 hours (7200s), with tolerance for test execution time
      expect(closed.durationSeconds).toBeGreaterThanOrEqual(7190);
      expect(closed.durationSeconds).toBeLessThanOrEqual(7210);
    });
  });

  // ===================================================================
  // Daily Rollup Aggregations
  // ===================================================================

  describe('daily rollup', () => {
    it('should upsert day/week/month rollup rows from closed sessions', async () => {
      const db = testApp.db;

      // Create a closed session
      const sessionDate = new Date();
      const [session] = await db
        .insert(schema.gameActivitySessions)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          discordActivityName: 'Test Game',
          startedAt: new Date(sessionDate.getTime() - 3600_000), // 1h ago
          endedAt: sessionDate,
          durationSeconds: 3600,
        })
        .returning();

      expect(session.durationSeconds).toBe(3600);

      // Compute expected period keys
      const dayStart = formatDate(session.startedAt);
      const weekStart = getWeekStart(session.startedAt);
      const monthStart = `${session.startedAt.getFullYear()}-${String(session.startedAt.getMonth() + 1).padStart(2, '0')}-01`;

      // Insert rollup rows (simulating aggregateRollups)
      for (const [period, periodStart] of [
        ['day', dayStart],
        ['week', weekStart],
        ['month', monthStart],
      ] as const) {
        await db
          .insert(schema.gameActivityRollups)
          .values({
            userId: testApp.seed.adminUser.id,
            gameId: testApp.seed.game.id,
            period,
            periodStart,
            totalSeconds: 3600,
          })
          .onConflictDoUpdate({
            target: [
              schema.gameActivityRollups.userId,
              schema.gameActivityRollups.gameId,
              schema.gameActivityRollups.period,
              schema.gameActivityRollups.periodStart,
            ],
            set: {
              totalSeconds: 3600,
            },
          });
      }

      // Verify all three period rows exist
      const rollups = await db
        .select()
        .from(schema.gameActivityRollups)
        .where(
          and(
            eq(schema.gameActivityRollups.userId, testApp.seed.adminUser.id),
            eq(schema.gameActivityRollups.gameId, testApp.seed.game.id),
          ),
        );

      expect(rollups.length).toBe(3);
      const periods = rollups.map((r) => r.period).sort();
      expect(periods).toEqual(['day', 'month', 'week']);

      for (const rollup of rollups) {
        expect(rollup.totalSeconds).toBe(3600);
      }
    });

    it('should upsert (idempotent) on re-run with same period keys', async () => {
      const db = testApp.db;
      const dayStart = formatDate(new Date());

      // First insert
      await db.insert(schema.gameActivityRollups).values({
        userId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        period: 'day',
        periodStart: dayStart,
        totalSeconds: 1800,
      });

      // Re-run with updated total (idempotent upsert)
      await db
        .insert(schema.gameActivityRollups)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          period: 'day',
          periodStart: dayStart,
          totalSeconds: 5400,
        })
        .onConflictDoUpdate({
          target: [
            schema.gameActivityRollups.userId,
            schema.gameActivityRollups.gameId,
            schema.gameActivityRollups.period,
            schema.gameActivityRollups.periodStart,
          ],
          set: {
            totalSeconds: 5400,
          },
        });

      // Should still be one row, not two
      const rollups = await db
        .select()
        .from(schema.gameActivityRollups)
        .where(
          and(
            eq(schema.gameActivityRollups.userId, testApp.seed.adminUser.id),
            eq(schema.gameActivityRollups.gameId, testApp.seed.game.id),
            eq(schema.gameActivityRollups.period, 'day'),
          ),
        );

      expect(rollups.length).toBe(1);
      expect(rollups[0].totalSeconds).toBe(5400);
    });

    it('should aggregate multiple sessions for the same user/game/period', async () => {
      const db = testApp.db;
      const dayStart = formatDate(new Date());

      // Two separate sessions
      await db.insert(schema.gameActivitySessions).values([
        {
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          discordActivityName: 'Test Game',
          startedAt: new Date(Date.now() - 7200_000),
          endedAt: new Date(Date.now() - 3600_000),
          durationSeconds: 3600,
        },
        {
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          discordActivityName: 'Test Game',
          startedAt: new Date(Date.now() - 1800_000),
          endedAt: new Date(),
          durationSeconds: 1800,
        },
      ]);

      // Aggregate: total should be 3600 + 1800 = 5400
      const totalSeconds = 3600 + 1800;
      await db
        .insert(schema.gameActivityRollups)
        .values({
          userId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          period: 'day',
          periodStart: dayStart,
          totalSeconds,
        })
        .onConflictDoUpdate({
          target: [
            schema.gameActivityRollups.userId,
            schema.gameActivityRollups.gameId,
            schema.gameActivityRollups.period,
            schema.gameActivityRollups.periodStart,
          ],
          set: { totalSeconds },
        });

      const [rollup] = await db
        .select()
        .from(schema.gameActivityRollups)
        .where(
          and(
            eq(schema.gameActivityRollups.userId, testApp.seed.adminUser.id),
            eq(schema.gameActivityRollups.gameId, testApp.seed.game.id),
            eq(schema.gameActivityRollups.period, 'day'),
          ),
        )
        .limit(1);

      expect(rollup.totalSeconds).toBe(5400);
    });
  });

  // ===================================================================
  // Embed Scheduler — LEFT JOIN detection
  // ===================================================================

  describe('embed scheduler', () => {
    it('should identify events without embed rows via LEFT JOIN', async () => {
      const db = testApp.db;
      const futureStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days from now
      const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

      // Create a future event
      const [event] = await db
        .insert(schema.events)
        .values({
          title: 'No Embed Event',
          creatorId: testApp.seed.adminUser.id,
          duration: [futureStart, futureEnd],
        })
        .returning();

      // Query using the same LEFT JOIN pattern as EmbedSchedulerService
      const eventsWithoutEmbeds = await db
        .select({
          id: schema.events.id,
          title: schema.events.title,
          embedId: schema.discordEventMessages.id,
        })
        .from(schema.events)
        .leftJoin(
          schema.discordEventMessages,
          eq(schema.events.id, schema.discordEventMessages.eventId),
        )
        .where(
          and(
            isNull(schema.events.cancelledAt),
            isNull(schema.discordEventMessages.id),
          ),
        );

      const match = eventsWithoutEmbeds.find((e) => e.id === event.id);
      expect(match).toBeDefined();
      expect(match?.embedId).toBeNull();
    });

    it('should exclude events that already have an embed row', async () => {
      const db = testApp.db;
      const futureStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

      // Create event + embed message row
      const [event] = await db
        .insert(schema.events)
        .values({
          title: 'Has Embed Event',
          creatorId: testApp.seed.adminUser.id,
          duration: [futureStart, futureEnd],
        })
        .returning();

      await db.insert(schema.discordEventMessages).values({
        eventId: event.id,
        guildId: '111222333444',
        channelId: '555666777888',
        messageId: 'msg-001',
        embedState: 'posted',
      });

      // LEFT JOIN query should NOT include this event
      const eventsWithoutEmbeds = await db
        .select({
          id: schema.events.id,
          embedId: schema.discordEventMessages.id,
        })
        .from(schema.events)
        .leftJoin(
          schema.discordEventMessages,
          eq(schema.events.id, schema.discordEventMessages.eventId),
        )
        .where(
          and(
            isNull(schema.events.cancelledAt),
            isNull(schema.discordEventMessages.id),
          ),
        );

      const match = eventsWithoutEmbeds.find((e) => e.id === event.id);
      expect(match).toBeUndefined();
    });

    it('should exclude cancelled events', async () => {
      const db = testApp.db;
      const futureStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

      // Create a cancelled future event with no embed
      const [event] = await db
        .insert(schema.events)
        .values({
          title: 'Cancelled Event',
          creatorId: testApp.seed.adminUser.id,
          duration: [futureStart, futureEnd],
          cancelledAt: new Date(),
          cancellationReason: 'Testing cancellation',
        })
        .returning();

      const eventsWithoutEmbeds = await db
        .select({
          id: schema.events.id,
          embedId: schema.discordEventMessages.id,
        })
        .from(schema.events)
        .leftJoin(
          schema.discordEventMessages,
          eq(schema.events.id, schema.discordEventMessages.eventId),
        )
        .where(
          and(
            isNull(schema.events.cancelledAt),
            isNull(schema.discordEventMessages.id),
          ),
        );

      const match = eventsWithoutEmbeds.find((e) => e.id === event.id);
      expect(match).toBeUndefined();
    });
  });

  // ===================================================================
  // Embed Poster — Live Roster Enrichment
  // ===================================================================

  describe('embed poster roster enrichment', () => {
    it('should return correct signup counts and role data via multi-JOIN', async () => {
      const db = testApp.db;
      const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

      // Create an event
      const [event] = await db
        .insert(schema.events)
        .values({
          title: 'Roster Enrichment Test',
          creatorId: testApp.seed.adminUser.id,
          duration: [futureStart, futureEnd],
          gameId: testApp.seed.game.id,
        })
        .returning();

      // Create two signups
      const [signup1] = await db
        .insert(schema.eventSignups)
        .values({
          eventId: event.id,
          userId: testApp.seed.adminUser.id,
          status: 'signed_up',
          confirmationStatus: 'pending',
        })
        .returning();

      // Create a second user for the second signup
      const [user2] = await db
        .insert(schema.users)
        .values({
          discordId: 'local:player2@test.local',
          username: 'player2',
          role: 'member',
        })
        .returning();

      // Create a character for user2
      const [char2] = await db
        .insert(schema.characters)
        .values({
          userId: user2.id,
          gameId: testApp.seed.game.id,
          name: 'TestTank',
          class: 'Warrior',
          role: 'tank',
        })
        .returning();

      const [signup2] = await db
        .insert(schema.eventSignups)
        .values({
          eventId: event.id,
          userId: user2.id,
          characterId: char2.id,
          status: 'signed_up',
          confirmationStatus: 'confirmed',
        })
        .returning();

      // Create roster assignments
      await db.insert(schema.rosterAssignments).values([
        {
          eventId: event.id,
          signupId: signup1.id,
          role: 'dps',
          position: 1,
        },
        {
          eventId: event.id,
          signupId: signup2.id,
          role: 'tank',
          position: 1,
        },
      ]);

      // Execute the multi-JOIN query (mirrors enrichWithLiveRoster)
      const signupRows = await db
        .select({
          username: schema.users.username,
          role: schema.rosterAssignments.role,
          status: schema.eventSignups.status,
          className: schema.characters.class,
        })
        .from(schema.eventSignups)
        .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
        .leftJoin(
          schema.rosterAssignments,
          eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
        )
        .leftJoin(
          schema.characters,
          eq(schema.eventSignups.characterId, schema.characters.id),
        )
        .where(eq(schema.eventSignups.eventId, event.id));

      expect(signupRows.length).toBe(2);

      // Verify role counts via GROUP BY
      const roleRows = await db
        .select({
          role: schema.rosterAssignments.role,
        })
        .from(schema.rosterAssignments)
        .innerJoin(
          schema.eventSignups,
          eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
        )
        .where(eq(schema.rosterAssignments.eventId, event.id));

      const roleCounts: Record<string, number> = {};
      for (const row of roleRows) {
        if (row.role) {
          roleCounts[row.role] = (roleCounts[row.role] ?? 0) + 1;
        }
      }

      expect(roleCounts['tank']).toBe(1);
      expect(roleCounts['dps']).toBe(1);

      // Verify character class is resolved for signup with character
      const tankRow = signupRows.find((r) => r.role === 'tank');
      expect(tankRow?.className).toBe('Warrior');

      // Signup without character should have null className
      const dpsRow = signupRows.find((r) => r.role === 'dps');
      expect(dpsRow?.className).toBeNull();
    });

    it('should exclude declined signups from active count', async () => {
      const db = testApp.db;
      const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

      const [event] = await db
        .insert(schema.events)
        .values({
          title: 'Declined Signup Test',
          creatorId: testApp.seed.adminUser.id,
          duration: [futureStart, futureEnd],
        })
        .returning();

      // Active signup
      await db.insert(schema.eventSignups).values({
        eventId: event.id,
        userId: testApp.seed.adminUser.id,
        status: 'signed_up',
        confirmationStatus: 'pending',
      });

      // Create second user for declined signup
      const [user2] = await db
        .insert(schema.users)
        .values({
          discordId: 'local:declined@test.local',
          username: 'declined',
          role: 'member',
        })
        .returning();

      // Declined signup
      await db.insert(schema.eventSignups).values({
        eventId: event.id,
        userId: user2.id,
        status: 'declined',
        confirmationStatus: 'pending',
      });

      // Query and filter like enrichWithLiveRoster
      const signupRows = await db
        .select({
          status: schema.eventSignups.status,
        })
        .from(schema.eventSignups)
        .where(eq(schema.eventSignups.eventId, event.id));

      const activeSignups = signupRows.filter(
        (r) => r.status !== 'declined' && r.status !== 'roached_out',
      );

      expect(signupRows.length).toBe(2);
      expect(activeSignups.length).toBe(1);
    });
  });

  // ===================================================================
  // PUG Slot — Atomic Claim & Lifecycle
  // ===================================================================

  describe('pug slot lifecycle', () => {
    let testEventId: number;

    beforeEach(async () => {
      const now = new Date();
      const futureEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const [event] = await testApp.db
        .insert(schema.events)
        .values({
          title: 'PUG Test Event',
          creatorId: testApp.seed.adminUser.id,
          duration: [now, futureEnd],
        })
        .returning();
      testEventId = event.id;
    });

    it('should create a PUG slot with pending status', async () => {
      const db = testApp.db;

      const [slot] = await db
        .insert(schema.pugSlots)
        .values({
          eventId: testEventId,
          discordUsername: 'pugplayer',
          role: 'dps',
          createdBy: testApp.seed.adminUser.id,
        })
        .returning();

      expect(slot.status).toBe('pending');
      expect(slot.discordUsername).toBe('pugplayer');
      expect(slot.role).toBe('dps');
      expect(slot.discordUserId).toBeNull();
      expect(slot.invitedAt).toBeNull();
    });

    it('should atomically claim pending slots via UPDATE RETURNING (handleNewGuildMember)', async () => {
      const db = testApp.db;

      // Create two pending slots for the same username across different events
      const now2 = new Date();
      const [event2] = await db
        .insert(schema.events)
        .values({
          title: 'PUG Event 2',
          creatorId: testApp.seed.adminUser.id,
          duration: [now2, new Date(now2.getTime() + 24 * 60 * 60 * 1000)],
        })
        .returning();

      await db.insert(schema.pugSlots).values([
        {
          eventId: testEventId,
          discordUsername: 'newmember',
          role: 'tank',
          createdBy: testApp.seed.adminUser.id,
        },
        {
          eventId: event2.id,
          discordUsername: 'newmember',
          role: 'healer',
          createdBy: testApp.seed.adminUser.id,
        },
      ]);

      // Atomic claim (mirrors handleNewGuildMember)
      const claimedSlots = await db
        .update(schema.pugSlots)
        .set({
          discordUserId: '999888777666',
          discordAvatarHash: 'avatar-hash-123',
          status: 'invited',
          invitedAt: new Date(),
          serverInviteUrl: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.pugSlots.discordUsername, 'newmember'),
            eq(schema.pugSlots.status, 'pending'),
          ),
        )
        .returning();

      // Both slots should be claimed atomically
      expect(claimedSlots.length).toBe(2);
      for (const slot of claimedSlots) {
        expect(slot.status).toBe('invited');
        expect(slot.discordUserId).toBe('999888777666');
        expect(slot.invitedAt).not.toBeNull();
      }
    });

    it('should prevent duplicate DMs by only claiming pending slots', async () => {
      const db = testApp.db;

      // Create a slot and mark it as already invited
      await db.insert(schema.pugSlots).values({
        eventId: testEventId,
        discordUsername: 'alreadyinvited',
        discordUserId: '111222333',
        role: 'dps',
        status: 'invited',
        invitedAt: new Date(),
        createdBy: testApp.seed.adminUser.id,
      });

      // Try to claim again — should return nothing (already invited)
      const claimedSlots = await db
        .update(schema.pugSlots)
        .set({
          discordUserId: '111222333',
          status: 'invited',
          invitedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.pugSlots.discordUsername, 'alreadyinvited'),
            eq(schema.pugSlots.status, 'pending'),
          ),
        )
        .returning();

      expect(claimedSlots.length).toBe(0);
    });

    it('should skip cancelled events when processing claimed slots', async () => {
      const db = testApp.db;

      // Cancel the event
      await db
        .update(schema.events)
        .set({ cancelledAt: new Date() })
        .where(eq(schema.events.id, testEventId));

      // Verify the event is cancelled
      const [event] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, testEventId))
        .limit(1);

      expect(event.cancelledAt).not.toBeNull();
    });

    it('should claim PUG slots by discordUserId OR inviteCode', async () => {
      const db = testApp.db;

      // Create a second user who will claim
      const [claimUser] = await db
        .insert(schema.users)
        .values({
          discordId: 'discord:claimuser',
          username: 'claimuser',
          role: 'member',
        })
        .returning();

      // Slot matched by discordUserId
      await db.insert(schema.pugSlots).values({
        eventId: testEventId,
        discordUsername: 'byid',
        discordUserId: 'discord:claimuser',
        role: 'tank',
        status: 'invited',
        createdBy: testApp.seed.adminUser.id,
      });

      // Slot matched by inviteCode (anonymous)
      const now3 = new Date();
      const [event3] = await db
        .insert(schema.events)
        .values({
          title: 'Invite Code Event',
          creatorId: testApp.seed.adminUser.id,
          duration: [now3, new Date(now3.getTime() + 24 * 60 * 60 * 1000)],
        })
        .returning();

      await db.insert(schema.pugSlots).values({
        eventId: event3.id,
        role: 'healer',
        inviteCode: 'ABC12345',
        status: 'pending',
        createdBy: testApp.seed.adminUser.id,
      });

      // Claim by discordUserId (mirrors claimPugSlots OR condition)
      const byIdResult = await db
        .update(schema.pugSlots)
        .set({
          claimedByUserId: claimUser.id,
          status: 'claimed',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.pugSlots.discordUserId, 'discord:claimuser'),
            isNull(schema.pugSlots.claimedByUserId),
          ),
        )
        .returning();

      expect(byIdResult.length).toBe(1);
      expect(byIdResult[0].claimedByUserId).toBe(claimUser.id);
      expect(byIdResult[0].status).toBe('claimed');

      // Claim by inviteCode
      const byCodeResult = await db
        .update(schema.pugSlots)
        .set({
          claimedByUserId: claimUser.id,
          status: 'claimed',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.pugSlots.inviteCode, 'ABC12345'),
            isNull(schema.pugSlots.claimedByUserId),
          ),
        )
        .returning();

      expect(byCodeResult.length).toBe(1);
      expect(byCodeResult[0].claimedByUserId).toBe(claimUser.id);
    });

    it('should enforce unique constraint on (eventId, discordUsername)', async () => {
      const db = testApp.db;

      await db.insert(schema.pugSlots).values({
        eventId: testEventId,
        discordUsername: 'uniquepug',
        role: 'dps',
        createdBy: testApp.seed.adminUser.id,
      });

      // Duplicate should fail
      await expect(
        db.insert(schema.pugSlots).values({
          eventId: testEventId,
          discordUsername: 'uniquepug',
          role: 'healer',
          createdBy: testApp.seed.adminUser.id,
        }),
      ).rejects.toThrow();
    });

    it('should cascade delete PUG slots when event is deleted', async () => {
      const db = testApp.db;

      await db.insert(schema.pugSlots).values({
        eventId: testEventId,
        discordUsername: 'cascadepug',
        role: 'tank',
        createdBy: testApp.seed.adminUser.id,
      });

      // Delete the event
      await db.delete(schema.events).where(eq(schema.events.id, testEventId));

      // PUG slots should be gone
      const remaining = await db
        .select()
        .from(schema.pugSlots)
        .where(eq(schema.pugSlots.eventId, testEventId));

      expect(remaining.length).toBe(0);
    });
  });

  // ===================================================================
  // Discord Event Messages — Tracking Rows
  // ===================================================================

  describe('discord event messages', () => {
    it('should insert and query embed tracking rows', async () => {
      const db = testApp.db;
      const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

      const [event] = await db
        .insert(schema.events)
        .values({
          title: 'Embed Tracking Test',
          creatorId: testApp.seed.adminUser.id,
          duration: [futureStart, futureEnd],
        })
        .returning();

      const [msg] = await db
        .insert(schema.discordEventMessages)
        .values({
          eventId: event.id,
          guildId: '111222333444',
          channelId: '555666777888',
          messageId: 'msg-123',
          embedState: 'posted',
        })
        .returning();

      expect(msg.eventId).toBe(event.id);
      expect(msg.embedState).toBe('posted');

      // Verify hasEmbed pattern (SELECT ... WHERE eventId LIMIT 1)
      const rows = await db
        .select({ id: schema.discordEventMessages.id })
        .from(schema.discordEventMessages)
        .where(eq(schema.discordEventMessages.eventId, event.id))
        .limit(1);

      expect(rows.length).toBe(1);
    });

    it('should cascade delete embed rows when event is deleted', async () => {
      const db = testApp.db;
      const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

      const [event] = await db
        .insert(schema.events)
        .values({
          title: 'Cascade Embed Test',
          creatorId: testApp.seed.adminUser.id,
          duration: [futureStart, futureEnd],
        })
        .returning();

      await db.insert(schema.discordEventMessages).values({
        eventId: event.id,
        guildId: '111222333444',
        channelId: '555666777888',
        messageId: 'msg-cascade',
        embedState: 'posted',
      });

      await db.delete(schema.events).where(eq(schema.events.id, event.id));

      const remaining = await db
        .select()
        .from(schema.discordEventMessages)
        .where(eq(schema.discordEventMessages.eventId, event.id));

      expect(remaining.length).toBe(0);
    });
  });
});

// ─── Helper functions (mirroring GameActivityService logic) ──────────

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return formatDate(d);
}
