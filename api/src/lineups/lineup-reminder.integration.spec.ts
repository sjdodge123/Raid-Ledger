/**
 * ROK-1126 — Lineup phase reminder cron (integration).
 *
 * TDD gate: pins down behavior of `LineupReminderService.checkVoteReminders`,
 * `checkSchedulingReminders`, and the new `checkNominationReminders` against
 * a real Postgres. These tests MUST fail until the dev agent:
 *   1. Creates `lineup-reminder-target.helpers.ts` with
 *      `resolveLineupReminderTargets(db, lineupId, action, matchId?)`.
 *   2. Wires `@Cron(EVERY_5_MINUTES)` + `executeWithTracking` to
 *      `checkVoteReminders` and `checkSchedulingReminders`.
 *   3. Adds `checkNominationReminders` (same shape).
 *   4. Routes recipient resolution for all three through the helper, applying
 *      the public/private + already-participated filter rules.
 *
 * Coverage (10 ACs):
 *   AC #5  — private + voting + 1h → invitees ∪ creator minus voters
 *   AC #6  — public + voting + 1h → participants minus voters
 *   AC #7  — private + building + 1h → invitees ∪ creator minus nominators
 *   AC #8  — public + building + 1h → all Discord-linked users minus nominators
 *   AC #5b — private + decided + 1h (scheduling phase) → invitees ∪ creator minus schedule-voters
 *   AC #10 — running checkVoteReminders twice → only one DM per recipient (dedup)
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { LineupReminderService } from './lineup-reminder.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';

const HOUR = 60 * 60 * 1000;

describe('LineupReminderService cron (integration, ROK-1126)', () => {
  let testApp: TestApp;
  let reminderService: LineupReminderService;
  let notificationService: NotificationService;
  let dedupService: NotificationDedupService;
  let createSpy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    reminderService = testApp.app.get(LineupReminderService);
    notificationService = testApp.app.get(NotificationService);
    dedupService = testApp.app.get(NotificationDedupService);
  });

  beforeEach(() => {
    createSpy = jest.spyOn(notificationService, 'create');
  });

  afterEach(async () => {
    createSpy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function createDiscordUser(tag: string): Promise<number> {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:${tag}-${Date.now()}-${Math.random()}`,
        username: `mem-${tag}-${Date.now()}`,
        role: 'member',
      })
      .returning();
    return user.id;
  }

  async function createGame(name: string): Promise<number> {
    const [g] = await testApp.db
      .insert(schema.games)
      .values({
        name: `${name}-${Date.now()}`,
        slug: `${name.toLowerCase()}-${Date.now()}-${Math.random()}`,
      })
      .returning();
    return g.id;
  }

  async function createLineup(opts: {
    visibility: 'public' | 'private';
    status: 'building' | 'voting' | 'decided';
    creatorId: number;
    phaseDeadlineHoursAhead: number;
  }): Promise<number> {
    const deadline = new Date(Date.now() + opts.phaseDeadlineHoursAhead * HOUR);
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: `ROK-1126 ${opts.visibility} ${opts.status}`,
        status: opts.status,
        visibility: opts.visibility,
        createdBy: opts.creatorId,
        phaseDeadline: deadline,
      })
      .returning();
    return lineup.id;
  }

  async function inviteUsers(
    lineupId: number,
    userIds: number[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    await testApp.db
      .insert(schema.communityLineupInvitees)
      .values(userIds.map((userId) => ({ lineupId, userId })));
  }

  async function nominateGame(
    lineupId: number,
    gameId: number,
    nominatedBy: number,
  ): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupEntries)
      .values({ lineupId, gameId, nominatedBy });
  }

  async function castVote(
    lineupId: number,
    gameId: number,
    userId: number,
  ): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupVotes)
      .values({ lineupId, gameId, userId });
  }

  function userIdsWhoReceivedSubtype(subtype: string): number[] {
    const ids = createSpy.mock.calls
      .map((c) => c[0] as { userId: number; payload?: { subtype?: string } })
      .filter((p) => p.payload?.subtype === subtype)
      .map((p) => p.userId);
    return Array.from(new Set(ids));
  }

  function dedupKeysSeen(): string[] {
    return (
      (
        dedupService.checkAndMarkSent as unknown as jest.Mock | undefined
      )?.mock?.calls?.map((c) => String(c[0])) ?? []
    );
  }

  // ── AC #5: private + voting + 1h ─────────────────────────────────────────

  describe('AC #5 — private voting + 1h-out deadline', () => {
    it('DMs creator + invitees who have not voted, none to non-invitees', async () => {
      const creatorId = await createDiscordUser('creator-5');
      const inviteeA = await createDiscordUser('inv-a-5');
      const inviteeB = await createDiscordUser('inv-b-5');
      const inviteeC = await createDiscordUser('inv-c-5');
      const bystander = await createDiscordUser('bystander-5');
      void bystander;

      const gameAId = await createGame('G5A');
      const gameBId = await createGame('G5B');

      const lineupId = await createLineup({
        visibility: 'private',
        status: 'voting',
        creatorId,
        phaseDeadlineHoursAhead: 50 / 60, // ~50 minutes
      });
      await inviteUsers(lineupId, [inviteeA, inviteeB, inviteeC]);
      await nominateGame(lineupId, gameAId, inviteeA);
      await nominateGame(lineupId, gameBId, inviteeB);
      // inviteeA already voted → must NOT receive a vote reminder.
      await castVote(lineupId, gameBId, inviteeA);

      jest.spyOn(dedupService, 'checkAndMarkSent');

      await reminderService.checkVoteReminders();

      const recipients = userIdsWhoReceivedSubtype('lineup_vote_reminder');
      // Creator + 2 unvoted invitees (B, C). NOT inviteeA (voted), NOT bystander.
      expect(new Set(recipients)).toEqual(
        new Set([creatorId, inviteeB, inviteeC]),
      );

      // Each DM is type=community_lineup with the right subtype.
      const matchingCalls = createSpy.mock.calls.filter(
        (c) =>
          (c[0] as { payload?: { subtype?: string } }).payload?.subtype ===
          'lineup_vote_reminder',
      );
      for (const [args] of matchingCalls) {
        expect(args).toMatchObject({ type: 'community_lineup' });
      }

      // Dedup key uses lineup-reminder-1h:{lineupId}:{userId} for the 1h window.
      const keys = dedupKeysSeen();
      for (const userId of [creatorId, inviteeB, inviteeC]) {
        expect(keys).toContain(`lineup-reminder-1h:${lineupId}:${userId}`);
      }
    });
  });

  // ── AC #6: public + voting + 1h ──────────────────────────────────────────

  describe('AC #6 — public voting + 1h-out deadline', () => {
    it('DMs only participants (nominators ∪ voters) minus already-voted', async () => {
      const creatorId = await createDiscordUser('creator-6');
      const nomA = await createDiscordUser('nom-a-6');
      const nomB = await createDiscordUser('nom-b-6');
      const voterC = await createDiscordUser('voter-c-6');
      const bystander = await createDiscordUser('bystander-6');
      void bystander;

      const gameAId = await createGame('G6A');
      const gameBId = await createGame('G6B');

      const lineupId = await createLineup({
        visibility: 'public',
        status: 'voting',
        creatorId,
        phaseDeadlineHoursAhead: 50 / 60,
      });

      // nomA + nomB nominate; voterC votes (and is also a participant).
      await nominateGame(lineupId, gameAId, nomA);
      await nominateGame(lineupId, gameBId, nomB);
      await castVote(lineupId, gameAId, voterC);
      // nomA also already voted → exclude from reminder set.
      await castVote(lineupId, gameBId, nomA);

      await reminderService.checkVoteReminders();

      const recipients = userIdsWhoReceivedSubtype('lineup_vote_reminder');
      // nomB has nominated but not voted → reminder.
      // nomA already voted → no reminder.
      // voterC already voted → no reminder.
      // bystander did not engage → no reminder.
      // creator did not engage → no reminder (public branch keys off participants).
      expect(new Set(recipients)).toEqual(new Set([nomB]));
    });
  });

  // ── AC #7: private + building + 1h ───────────────────────────────────────

  describe('AC #7 — private building + 1h-out deadline', () => {
    it('DMs creator + invitees who have not nominated', async () => {
      const creatorId = await createDiscordUser('creator-7');
      const inviteeA = await createDiscordUser('inv-a-7');
      const inviteeB = await createDiscordUser('inv-b-7');

      const gameAId = await createGame('G7A');

      const lineupId = await createLineup({
        visibility: 'private',
        status: 'building',
        creatorId,
        phaseDeadlineHoursAhead: 50 / 60,
      });
      await inviteUsers(lineupId, [inviteeA, inviteeB]);
      // inviteeA has nominated → exclude from reminders.
      await nominateGame(lineupId, gameAId, inviteeA);

      await reminderService.checkNominationReminders();

      const recipients = userIdsWhoReceivedSubtype('lineup_nominate_reminder');
      // Creator + inviteeB (the only one who hasn't nominated yet).
      expect(new Set(recipients)).toEqual(new Set([creatorId, inviteeB]));

      // payload.subtype is 'lineup_nominate_reminder' and type is community_lineup
      const matchingCalls = createSpy.mock.calls.filter(
        (c) =>
          (c[0] as { payload?: { subtype?: string } }).payload?.subtype ===
          'lineup_nominate_reminder',
      );
      for (const [args] of matchingCalls) {
        expect(args).toMatchObject({
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_nominate_reminder',
            lineupId,
          }),
        });
      }
    });
  });

  // ── AC #8: public + building + 1h ────────────────────────────────────────

  describe('AC #8 — public building + 1h-out deadline', () => {
    it('DMs every Discord-linked user who has not nominated', async () => {
      const creatorId = await createDiscordUser('creator-8');
      const userA = await createDiscordUser('u-a-8');
      const userB = await createDiscordUser('u-b-8');
      const userC = await createDiscordUser('u-c-8');

      await createLineup({
        visibility: 'public',
        status: 'building',
        creatorId,
        phaseDeadlineHoursAhead: 50 / 60,
      });

      await reminderService.checkNominationReminders();

      const recipients = userIdsWhoReceivedSubtype('lineup_nominate_reminder');
      // All four discord-linked users should receive a reminder (no nominations yet).
      // Note: the seeded admin user from test-app's baseline also has discord_id
      // set, so we assert SUPERSET of our four users — not exact equality —
      // because the public branch fans out to every linked member.
      expect(recipients).toEqual(
        expect.arrayContaining([creatorId, userA, userB, userC]),
      );
    });
  });

  // ── AC #5b: private + decided (scheduling) + 1h ──────────────────────────

  describe('AC #5b — private decided (scheduling) + 1h-out deadline', () => {
    it('DMs match members (creator + invitees) who have not voted on a slot', async () => {
      const creatorId = await createDiscordUser('creator-5b');
      const inviteeA = await createDiscordUser('inv-a-5b');
      const inviteeB = await createDiscordUser('inv-b-5b');

      const gameAId = await createGame('G5B-A');

      const lineupId = await createLineup({
        visibility: 'private',
        status: 'decided',
        creatorId,
        phaseDeadlineHoursAhead: 50 / 60,
      });
      await inviteUsers(lineupId, [inviteeA, inviteeB]);

      // Create a scheduling match with all 3 users as members.
      const [match] = await testApp.db
        .insert(schema.communityLineupMatches)
        .values({
          lineupId,
          gameId: gameAId,
          status: 'scheduling',
          voteCount: 0,
        })
        .returning();
      await testApp.db.insert(schema.communityLineupMatchMembers).values([
        { matchId: match.id, userId: creatorId, source: 'voted' },
        { matchId: match.id, userId: inviteeA, source: 'voted' },
        { matchId: match.id, userId: inviteeB, source: 'voted' },
      ]);
      // Add a slot and have inviteeA vote on it → exclude from reminders.
      const [slot] = await testApp.db
        .insert(schema.communityLineupScheduleSlots)
        .values({
          matchId: match.id,
          proposedTime: new Date(Date.now() + 24 * HOUR),
          suggestedBy: 'system',
        })
        .returning();
      await testApp.db
        .insert(schema.communityLineupScheduleVotes)
        .values({ slotId: slot.id, userId: inviteeA });

      await reminderService.checkSchedulingReminders();

      const recipients = userIdsWhoReceivedSubtype(
        'lineup_scheduling_reminder',
      );
      expect(new Set(recipients)).toEqual(new Set([creatorId, inviteeB]));
    });
  });

  // ── AC #10: dedup prevents duplicate DMs across firings ──────────────────

  describe('AC #10 — dedup prevents duplicate DMs across cron firings', () => {
    it('running checkVoteReminders twice still produces 1 DM per recipient', async () => {
      const creatorId = await createDiscordUser('creator-10');
      const inviteeA = await createDiscordUser('inv-a-10');

      const lineupId = await createLineup({
        visibility: 'private',
        status: 'voting',
        creatorId,
        phaseDeadlineHoursAhead: 50 / 60,
      });
      await inviteUsers(lineupId, [inviteeA]);

      await reminderService.checkVoteReminders();
      await reminderService.checkVoteReminders();

      const recipients = createSpy.mock.calls
        .map((c) => c[0] as { userId: number; payload?: { subtype?: string } })
        .filter((p) => p.payload?.subtype === 'lineup_vote_reminder')
        .map((p) => p.userId);

      // Each recipient appears exactly once across the two cron firings.
      const counts = new Map<number, number>();
      for (const id of recipients) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const [, count] of counts) {
        expect(count).toBe(1);
      }
      expect(new Set(recipients)).toEqual(new Set([creatorId, inviteeA]));
    });
  });

  // ── Sanity: the helper module + new service method exist ─────────────────

  it('LineupReminderService exposes a checkNominationReminders method', () => {
    // Compile-time: this references the new public method. Until the dev
    // adds it, TypeScript reports "Property 'checkNominationReminders' does
    // not exist on type 'LineupReminderService'" and the spec fails.
    expect(typeof reminderService.checkNominationReminders).toBe('function');
  });
});
