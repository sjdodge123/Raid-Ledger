/**
 * ROK-1115 — Integration tests for private-lineup channel-embed gating.
 *
 * Verifies that the four lifecycle notification methods do NOT post
 * channel embeds when the lineup is `visibility='private'`, and that
 * invitees + creator are routed via DM instead.
 *
 * Strategy:
 *   - Use the real DB to create a private lineup with invitees.
 *   - Stub `DiscordBotClientService.sendEmbed` so we can spy on whether
 *     channel embed dispatch was attempted.
 *   - Drive `LineupNotificationService.notify*` methods directly with
 *     visibility='private' lineup info; this is more deterministic than
 *     racing through HTTP + phase-machine triggers.
 *   - Assert sendEmbed was never called and notification rows landed
 *     for invitee userIds.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { LineupNotificationService } from './lineup-notification.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';

interface PrivateLineupSetup {
  lineupId: number;
  inviteeIds: number[];
}

function describePrivateNotifications() {
  let testApp: TestApp;
  let adminToken: string;
  let service: LineupNotificationService;
  let botClient: DiscordBotClientService;
  let settings: SettingsService;
  let sendEmbedSpy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    service = testApp.app.get(LineupNotificationService);
    botClient = testApp.app.get(DiscordBotClientService);
    settings = testApp.app.get(SettingsService);
    void adminToken; // present for future HTTP-driven tests
  });

  beforeEach(async () => {
    // Re-stub before every test so the spy mock object is fresh.
    sendEmbedSpy = jest
      .spyOn(botClient, 'sendEmbed')
      .mockResolvedValue({ id: 'mock-msg' } as never);
    // Bind a default channel so the channel-dispatch path WOULD fire if
    // visibility were public — this is what makes the negative assertion
    // meaningful.
    await settings.setDiscordBotDefaultChannel('test-channel-private-1115');
  });

  afterEach(async () => {
    sendEmbedSpy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function createInvitee(discordSuffix: string): Promise<number> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:${discordSuffix}`,
        username: `inv-${discordSuffix}`,
        role: 'member',
      })
      .returning();
    return user.id;
  }

  async function setupPrivateLineup(): Promise<PrivateLineupSetup> {
    const inviteeId = await createInvitee('inv1-1115');
    const inviteeId2 = await createInvitee('inv2-1115');
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'ROK-1115 private',
        status: 'building',
        visibility: 'private',
        createdBy: testApp.seed.adminUser.id,
      })
      .returning();
    await testApp.db.insert(schema.communityLineupInvitees).values([
      { lineupId: lineup.id, userId: inviteeId },
      { lineupId: lineup.id, userId: inviteeId2 },
    ]);
    // Give the admin a Discord ID so the creator-union has a hit.
    await testApp.db
      .update(schema.users)
      .set({ discordId: 'discord:admin-1115' })
      .where(eq(schema.users.id, testApp.seed.adminUser.id));
    return { lineupId: lineup.id, inviteeIds: [inviteeId, inviteeId2] };
  }

  async function notificationsForUser(userId: number): Promise<unknown[]> {
    return testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
  }

  // ── notifyNominationMilestone ────────────────────────────────────────────

  it('notifyNominationMilestone does not post channel embed for private lineup', async () => {
    const { lineupId, inviteeIds } = await setupPrivateLineup();

    await (
      service.notifyNominationMilestone as unknown as (
        ...a: unknown[]
      ) => Promise<void>
    )(
      lineupId,
      50,
      [{ gameId: 1, gameName: 'Game', nominatorName: 'U', coverUrl: null }],
      { id: lineupId, visibility: 'private', title: 'ROK-1115 private' },
    );

    expect(sendEmbedSpy).not.toHaveBeenCalled();
    // Each invitee has a community_lineup notification row.
    for (const id of inviteeIds) {
      const rows = await notificationsForUser(id);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  // ── notifyMatchesFound (decided phase) ───────────────────────────────────

  it('notifyMatchesFound does not post channel embed for private lineup', async () => {
    const { lineupId, inviteeIds } = await setupPrivateLineup();

    // Insert a match so the helper has data to process.
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId,
        gameId: testApp.seed.game.id,
        status: 'suggested',
        thresholdMet: true,
        voteCount: 5,
      })
      .returning();

    await (
      service.notifyMatchesFound as unknown as (
        ...a: unknown[]
      ) => Promise<void>
    )(
      lineupId,
      [
        {
          id: match.id,
          lineupId,
          gameId: testApp.seed.game.id,
          gameName: 'GameName',
          status: 'suggested',
          thresholdMet: true,
          voteCount: 5,
        },
      ],
      { id: lineupId, visibility: 'private', title: 'ROK-1115 private' },
    );

    expect(sendEmbedSpy).not.toHaveBeenCalled();
    for (const id of inviteeIds) {
      const rows = await notificationsForUser(id);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  // ── notifySchedulingOpen ─────────────────────────────────────────────────

  it('notifySchedulingOpen does not post channel embed for private lineup', async () => {
    const { lineupId, inviteeIds } = await setupPrivateLineup();
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId,
        gameId: testApp.seed.game.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 5,
      })
      .returning();

    await (
      service.notifySchedulingOpen as unknown as (
        ...a: unknown[]
      ) => Promise<void>
    )(
      {
        id: match.id,
        lineupId,
        gameId: testApp.seed.game.id,
        gameName: 'GameName',
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 5,
      },
      { id: lineupId, visibility: 'private', title: 'ROK-1115 private' },
    );

    expect(sendEmbedSpy).not.toHaveBeenCalled();
    for (const id of inviteeIds) {
      const rows = await notificationsForUser(id);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  // ── notifyEventCreated ───────────────────────────────────────────────────

  it('notifyEventCreated does not post channel embed for private lineup', async () => {
    const { lineupId, inviteeIds } = await setupPrivateLineup();
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId,
        gameId: testApp.seed.game.id,
        status: 'scheduled',
        thresholdMet: true,
        voteCount: 5,
      })
      .returning();

    await (
      service.notifyEventCreated as unknown as (
        ...a: unknown[]
      ) => Promise<void>
    )(
      {
        id: match.id,
        lineupId,
        gameId: testApp.seed.game.id,
        gameName: 'GameName',
        status: 'scheduled',
        thresholdMet: true,
        voteCount: 5,
        linkedEventId: 200,
      },
      new Date('2026-04-25T18:00:00Z'),
      200,
      { id: lineupId, visibility: 'private', title: 'ROK-1115 private' },
    );

    expect(sendEmbedSpy).not.toHaveBeenCalled();
    for (const id of inviteeIds) {
      const rows = await notificationsForUser(id);
      expect(rows.length).toBeGreaterThan(0);
    }
  });
}

describe(
  'Lineups — private-visibility channel gating (integration, ROK-1115)',
  describePrivateNotifications,
);
