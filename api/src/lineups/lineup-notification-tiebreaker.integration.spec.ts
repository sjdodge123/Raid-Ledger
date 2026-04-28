/**
 * ROK-1117 — Tiebreaker open notifications (integration).
 *
 * TDD gate: these tests pin down the spec for tiebreaker-open
 * notification fan-out. They MUST fail until the dev agent wires
 * `LineupNotificationService.notifyTiebreakerOpen` into
 * `TiebreakerService.start()`.
 *
 * Coverage:
 *   - Public lineup tiebreaker.start() → DMs fan out to every user
 *     returned by `loadExpectedVoters` (nominators ∪ voters), and a
 *     channel embed is posted with dedup key
 *     `lineup-tiebreaker-open:<tbId>`.
 *   - Private lineup tiebreaker.start() → DMs fan out to invitees +
 *     creator, channel embed is suppressed (mirrors ROK-1065 routing).
 *
 * Strategy:
 *   - Real DB (Testcontainers) for lineup / entries / votes / users.
 *   - Stub `DiscordBotClientService.sendEmbed` so we can assert whether
 *     the channel-embed path was invoked.
 *   - Drive `TiebreakerService.start()` directly (deterministic), then
 *     read notification rows + the sendEmbed spy.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { TiebreakerService } from './tiebreaker/tiebreaker.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { LineupReminderService } from './lineup-reminder.service';

interface PublicLineupSetup {
  lineupId: number;
  tiedGameIds: [number, number];
  participantIds: number[];
}

interface PrivateLineupSetup {
  lineupId: number;
  tiedGameIds: [number, number];
  inviteeIds: number[];
  creatorId: number;
}

function describeTiebreakerNotifications() {
  let testApp: TestApp;
  let adminToken: string;
  let tiebreakerService: TiebreakerService;
  let botClient: DiscordBotClientService;
  let settings: SettingsService;
  let dedup: NotificationDedupService;
  let sendEmbedSpy: jest.SpyInstance;
  let dedupSpy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    tiebreakerService = testApp.app.get(TiebreakerService);
    botClient = testApp.app.get(DiscordBotClientService);
    settings = testApp.app.get(SettingsService);
    dedup = testApp.app.get(NotificationDedupService);
    void adminToken;
  });

  beforeEach(async () => {
    sendEmbedSpy = jest
      .spyOn(botClient, 'sendEmbed')
      .mockResolvedValue({ id: 'mock-msg-tb' } as never);
    dedupSpy = jest.spyOn(dedup, 'checkAndMarkSent');
    // Bind a default channel so the channel-dispatch path WOULD fire if
    // visibility were public — needed for the public-channel assertion.
    await settings.setDiscordBotDefaultChannel('test-channel-tb-1117');
  });

  afterEach(async () => {
    sendEmbedSpy.mockRestore();
    dedupSpy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  async function createMember(tag: string): Promise<number> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:${tag}`,
        username: `mem-${tag}`,
        role: 'member',
      })
      .returning();
    return user.id;
  }

  async function createGame(name: string): Promise<number> {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({ name, slug: `${name.toLowerCase()}-${Date.now()}` })
      .returning();
    return g.id;
  }

  /**
   * Build a public lineup in voting status with two tied games and
   * three distinct participants (one nominator-only, two voters).
   * The expected DM target = nominators ∪ voters.
   */
  async function setupPublicLineup(): Promise<PublicLineupSetup> {
    const nominator = await createMember('pub-nom-1117');
    const voterA = await createMember('pub-voter-a-1117');
    const voterB = await createMember('pub-voter-b-1117');
    const gameAId = await createGame('TBGameA-1117');
    const gameBId = await createGame('TBGameB-1117');

    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'ROK-1117 public',
        status: 'voting',
        visibility: 'public',
        createdBy: testApp.seed.adminUser.id,
      })
      .returning();

    // Nominate both games (nominator owns gameA, voterA owns gameB).
    await testApp.db.insert(schema.communityLineupEntries).values([
      { lineupId: lineup.id, gameId: gameAId, nominatedBy: nominator },
      { lineupId: lineup.id, gameId: gameBId, nominatedBy: voterA },
    ]);
    // Cast equal votes to produce a tie.
    await testApp.db.insert(schema.communityLineupVotes).values([
      { lineupId: lineup.id, gameId: gameAId, userId: voterA },
      { lineupId: lineup.id, gameId: gameBId, userId: voterB },
    ]);

    return {
      lineupId: lineup.id,
      tiedGameIds: [gameAId, gameBId],
      participantIds: Array.from(new Set([nominator, voterA, voterB])),
    };
  }

  /**
   * Build a private lineup in voting status with two tied games and
   * two invitees + creator. Expected DM target = creator ∪ invitees.
   */
  async function setupPrivateLineup(): Promise<PrivateLineupSetup> {
    const inviteeA = await createMember('priv-inv-a-1117');
    const inviteeB = await createMember('priv-inv-b-1117');
    const gameAId = await createGame('TBPrivA-1117');
    const gameBId = await createGame('TBPrivB-1117');
    const creatorId = testApp.seed.adminUser.id;

    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'ROK-1117 private',
        status: 'voting',
        visibility: 'private',
        createdBy: creatorId,
      })
      .returning();
    await testApp.db.insert(schema.communityLineupInvitees).values([
      { lineupId: lineup.id, userId: inviteeA },
      { lineupId: lineup.id, userId: inviteeB },
    ]);
    await testApp.db.insert(schema.communityLineupEntries).values([
      { lineupId: lineup.id, gameId: gameAId, nominatedBy: creatorId },
      { lineupId: lineup.id, gameId: gameBId, nominatedBy: inviteeA },
    ]);
    await testApp.db.insert(schema.communityLineupVotes).values([
      { lineupId: lineup.id, gameId: gameAId, userId: inviteeA },
      { lineupId: lineup.id, gameId: gameBId, userId: inviteeB },
    ]);

    // Give the creator a discordId so they qualify for DM dispatch.
    await testApp.db
      .update(schema.users)
      .set({ discordId: 'discord:admin-1117' })
      .where(eq(schema.users.id, creatorId));

    return {
      lineupId: lineup.id,
      tiedGameIds: [gameAId, gameBId],
      inviteeIds: [inviteeA, inviteeB],
      creatorId,
    };
  }

  async function notificationsForUser(userId: number): Promise<unknown[]> {
    return testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
  }

  /**
   * Pick the tiebreaker-open DM row for a given user (ROK-1117 rework).
   * Returns `undefined` when no matching DM was created so the
   * `toBeTruthy` assertion gives a clear failure.
   */
  async function findTiebreakerOpenDM(
    userId: number,
  ): Promise<{ message: string; payload: unknown } | undefined> {
    const rows = (await notificationsForUser(userId)) as Array<{
      message: string;
      payload: { subtype?: string } | null;
    }>;
    return rows.find((r) => r.payload?.subtype === 'lineup_tiebreaker_open');
  }

  function dedupKeysSeen(): string[] {
    return dedupSpy.mock.calls.map((c) => String(c[0]));
  }

  // ── AC: public lineup → DMs + channel embed ────────────────────────────

  it('public tiebreaker.start() DMs every expected voter and posts channel embed', async () => {
    const { lineupId, participantIds, tiedGameIds } = await setupPublicLineup();

    const tiebreaker = await tiebreakerService.start(lineupId, {
      mode: 'veto',
      roundDurationHours: 24,
    });
    expect(tiebreaker).toBeTruthy();

    // Wait briefly for fire-and-forget hook to settle.
    await new Promise((r) => setImmediate(r));

    // Every expected voter receives a community_lineup notification row.
    for (const userId of participantIds) {
      const rows = await notificationsForUser(userId);
      expect(rows.length).toBeGreaterThan(0);
    }

    // Public lineup → channel embed dispatched.
    expect(sendEmbedSpy).toHaveBeenCalled();

    // Dedup key for the channel embed is `lineup-tiebreaker-open:<tbId>`.
    const expectedKey = `lineup-tiebreaker-open:${tiebreaker.id}`;
    expect(dedupKeysSeen()).toContain(expectedKey);

    // ROK-1117 rework: the open-DM body lists tied games as deep links
    // and ends with a CTA pointing at the lineup detail page.
    const openDmRow = await findTiebreakerOpenDM(participantIds[0]);
    expect(openDmRow).toBeTruthy();
    const message = openDmRow!.message;
    for (const gameId of tiedGameIds) {
      expect(message).toMatch(
        new RegExp(`🎮 \\[\\*\\*.+\\*\\*\\]\\(.+/games/${gameId}\\)`),
      );
    }
    expect(message).toMatch(
      new RegExp(
        `\\[(Cast your veto( now)?|Vote in the bracket)\\]\\(.+/community-lineup/${lineupId}\\)`,
      ),
    );
  });

  // ── AC: private lineup → DMs only, no channel embed ────────────────────

  it('private tiebreaker.start() DMs invitees + creator and suppresses channel embed', async () => {
    const { lineupId, inviteeIds, creatorId } = await setupPrivateLineup();

    const tiebreaker = await tiebreakerService.start(lineupId, {
      mode: 'bracket',
      roundDurationHours: 24,
    });
    expect(tiebreaker).toBeTruthy();

    await new Promise((r) => setImmediate(r));

    expect(sendEmbedSpy).not.toHaveBeenCalled();

    // Every invitee + creator receives a notification row.
    for (const userId of [...inviteeIds, creatorId]) {
      const rows = await notificationsForUser(userId);
      expect(rows.length).toBeGreaterThan(0);
    }
  });
}

describe(
  'Lineup tiebreaker-open notifications (integration, ROK-1117)',
  describeTiebreakerNotifications,
);

// ── ROK-1117: Tiebreaker reminder cron (integration) ──────────────────────

function describeTiebreakerReminders() {
  let testApp: TestApp;
  let tiebreakerService: TiebreakerService;
  let reminderService: LineupReminderService;
  let dedup: NotificationDedupService;

  beforeAll(async () => {
    testApp = await getTestApp();
    tiebreakerService = testApp.app.get(TiebreakerService);
    reminderService = testApp.app.get(LineupReminderService);
    dedup = testApp.app.get(NotificationDedupService);
    // Stub the bot's sendEmbed so the start() side-effects don't fail.
    jest
      .spyOn(testApp.app.get(DiscordBotClientService), 'sendEmbed')
      .mockResolvedValue({ id: 'mock-msg-tb-rem' } as never);
  });

  afterEach(async () => {
    jest.useRealTimers();
    testApp.seed = await truncateAllTables(testApp.db);
    // Clear dedup keys so the next test isn't blocked by prior ones.
    jest.spyOn(dedup, 'checkAndMarkSent').mockResolvedValue(false);
  });

  async function createMember(tag: string): Promise<number> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:${tag}`,
        username: `mem-${tag}`,
        role: 'member',
      })
      .returning();
    return user.id;
  }

  async function createGame(name: string): Promise<number> {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({ name, slug: `${name.toLowerCase()}-${Date.now()}` })
      .returning();
    return g.id;
  }

  async function setupLineupWithActiveTiebreaker(): Promise<{
    lineupId: number;
    participantIds: number[];
  }> {
    const nominator = await createMember('rem-nom-1117');
    const voterA = await createMember('rem-voter-a-1117');
    const voterB = await createMember('rem-voter-b-1117');
    const gameAId = await createGame('TBRemA-1117');
    const gameBId = await createGame('TBRemB-1117');

    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'ROK-1117 reminder',
        status: 'voting',
        visibility: 'public',
        createdBy: testApp.seed.adminUser.id,
      })
      .returning();
    await testApp.db.insert(schema.communityLineupEntries).values([
      { lineupId: lineup.id, gameId: gameAId, nominatedBy: nominator },
      { lineupId: lineup.id, gameId: gameBId, nominatedBy: voterA },
    ]);
    await testApp.db.insert(schema.communityLineupVotes).values([
      { lineupId: lineup.id, gameId: gameAId, userId: voterA },
      { lineupId: lineup.id, gameId: gameBId, userId: voterB },
    ]);
    await tiebreakerService.start(lineup.id, {
      mode: 'veto',
      roundDurationHours: 1,
    });
    return {
      lineupId: lineup.id,
      participantIds: [nominator, voterA, voterB],
    };
  }

  it('checkTiebreakerReminders DMs every non-engaged expected voter at the 1h threshold', async () => {
    const { lineupId, participantIds } =
      await setupLineupWithActiveTiebreaker();

    // Move the round_deadline to ~50 minutes from now so classifyThreshold
    // returns '1h' and the cron path fires reminders.
    const newDeadline = new Date(Date.now() + 50 * 60 * 1000);
    await testApp.db
      .update(schema.communityLineupTiebreakers)
      .set({ roundDeadline: newDeadline })
      .where(eq(schema.communityLineupTiebreakers.lineupId, lineupId));

    // Reset the dedup spy so the open-DMs from start() don't bleed.
    jest.spyOn(dedup, 'checkAndMarkSent').mockResolvedValue(false);

    await reminderService.checkTiebreakerReminders();

    // Each expected voter should have received at least one reminder
    // notification with the tiebreaker-reminder subtype. The DM body
    // must list the tied games as deep links and end with a CTA
    // pointing at the lineup detail page (ROK-1117 rework).
    for (const userId of participantIds) {
      const rows = await testApp.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, userId));
      const reminderRows = rows.filter((r) => {
        const payload = r.payload as { subtype?: string } | null;
        return payload?.subtype === 'lineup_tiebreaker_reminder';
      });
      expect(reminderRows.length).toBeGreaterThan(0);
      const message = reminderRows[0].message;
      expect(message).toMatch(/🎮 \[\*\*.+\*\*\]\(.+\/games\/\d+\)/);
      expect(message).toMatch(
        new RegExp(
          `\\[(Cast your veto|Vote in the bracket)\\]\\(.+/community-lineup/${lineupId}\\)`,
        ),
      );
    }
  });

  it('checkTiebreakerReminders is a no-op when no tiebreakers are active', async () => {
    // No setup: empty DB. Just verify it doesn't throw.
    await expect(
      reminderService.checkTiebreakerReminders(),
    ).resolves.toBeUndefined();
  });
}

describe(
  'Lineup tiebreaker reminder cron (integration, ROK-1117)',
  describeTiebreakerReminders,
);
