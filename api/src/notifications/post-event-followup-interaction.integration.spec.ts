/**
 * ROK-1371 — Post-event follow-up: organizer prompt + button interactions (M3)
 * and attendee fan-out (M4) integration tests.
 *
 * The M1 recipient resolver + M2 cron candidate detection are covered by the
 * sibling `post-event-followup.integration.spec.ts`. This file covers the
 * UNCOVERED behavior:
 *   M3  sendOrganizerPrompt button rendering + organizer gating
 *       handleScheduleClick / handlePollClick / route (interaction handlers)
 *   M4  runFollowupFanout (shared exactly-once attendee fan-out)
 *
 * Per CLAUDE.md, button/interaction handlers are tested directly here (a bot
 * cannot click another bot's buttons). Discord `ButtonInteraction`,
 * `StandalonePollService.create`, and (mostly) `NotificationService.createMany`
 * are mocked; DB effects (sentinels, events, notifications rows) are real.
 */
import { Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { ButtonInteraction } from 'discord.js';
import type { SchedulingPollResponseDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { NotificationService } from './notification.service';
import { PostEventFollowupPromptService } from './post-event-followup-prompt.service';
import { runFollowupFanout } from './post-event-followup-fanout.helpers';
import { PostEventFollowupInteractionListener } from '../discord-bot/listeners/post-event-followup-interaction.listener';
import {
  handlePollClick,
  handleScheduleClick,
  lookupFollowupEvent,
  parsePostEventFollowupButton,
  type FollowupInteractionEvent,
  type PostEventFollowupDeps,
} from '../discord-bot/listeners/post-event-followup-interaction.handlers';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
let discordSeq = 0;

async function mkUser(
  testApp: TestApp,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  discordSeq += 1;
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `70000000000000${String(discordSeq).padStart(4, '0')}`,
      username: `u${discordSeq}`,
      role: 'member',
      ...overrides,
    })
    .returning();
  return user;
}

async function mkEvent(
  testApp: TestApp,
  creatorId: number,
  overrides: Partial<typeof schema.events.$inferInsert> = {},
) {
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Ended Event',
      creatorId,
      duration: [new Date(Date.now() - 3 * HOUR), new Date(Date.now() - HOUR)],
      ...overrides,
    })
    .returning();
  return event;
}

async function mkSignup(
  testApp: TestApp,
  eventId: number,
  userId: number,
  status = 'signed_up',
) {
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, status });
}

/** Insert the M2 dedup/single-fire sentinel row (the cron creates this). */
async function insertSentinel(
  testApp: TestApp,
  eventId: number,
  fields: { choice?: string; attendeesNotifiedAt?: Date } = {},
) {
  await testApp.db.insert(schema.postEventFollowupSent).values({
    eventId,
    choice: fields.choice ?? null,
    attendeesNotifiedAt: fields.attendeesNotifiedAt ?? null,
  });
}

async function getSentinel(testApp: TestApp, eventId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.postEventFollowupSent)
    .where(eq(schema.postEventFollowupSent.eventId, eventId))
    .limit(1);
  return row;
}

async function getEvent(testApp: TestApp, eventId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row;
}

async function countEvents(testApp: TestApp): Promise<number> {
  const [row] = await testApp.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.events);
  return Number(row.n);
}

/** Opt a user out of post_event_followup Discord delivery (raw jsonb prefs). */
async function optOutFollowupDiscord(testApp: TestApp, userId: number) {
  await testApp.db.execute(sql`
    INSERT INTO user_notification_preferences (user_id, channel_prefs)
    VALUES (${userId}, ${'{"post_event_followup":{"inApp":true,"push":false,"discord":false}}'}::jsonb)
  `);
}

/** A discord.js ButtonInteraction stub — handlers only touch editReply. */
function mockInteraction(): { editReply: jest.Mock } & ButtonInteraction {
  return { editReply: jest.fn().mockResolvedValue(undefined) } as unknown as {
    editReply: jest.Mock;
  } & ButtonInteraction;
}

function pollResponse(
  gameId: number,
  ids: { id: number; lineupId: number },
): SchedulingPollResponseDto {
  return {
    id: ids.id,
    lineupId: ids.lineupId,
    gameId,
    gameName: 'Test Game',
    gameCoverUrl: null,
    memberCount: 1,
    status: 'scheduling',
    createdAt: new Date().toISOString(),
  };
}

/** Build handler deps with real DB + jest mocks for the external collaborators. */
function makeDeps(
  testApp: TestApp,
  over: {
    create?: jest.Mock;
    createMany?: jest.Mock;
    getClientUrl?: jest.Mock;
  } = {},
): PostEventFollowupDeps & {
  create: jest.Mock;
  createMany: jest.Mock;
} {
  const create = over.create ?? jest.fn();
  const createMany = over.createMany ?? jest.fn().mockResolvedValue([]);
  const getClientUrl =
    over.getClientUrl ?? jest.fn().mockResolvedValue('https://app.test');
  return {
    db: testApp.db,
    standalonePollService: { create },
    notificationService: { createMany },
    settingsService: { getClientUrl },
    logger: new Logger('pef-test'),
    create,
    createMany,
  };
}

describe('Post-event follow-up interactions + fan-out (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // =================================================================
  // Custom-id parsing + event lookup
  // =================================================================
  describe('parsePostEventFollowupButton / lookupFollowupEvent', () => {
    it('parses pef_schedule / pef_poll and ignores foreign custom ids', () => {
      expect(parsePostEventFollowupButton('pef_schedule:42')).toEqual({
        action: 'pef_schedule',
        endedEventId: 42,
      });
      expect(parsePostEventFollowupButton('pef_poll:7')).toEqual({
        action: 'pef_poll',
        endedEventId: 7,
      });
      expect(parsePostEventFollowupButton('signup:7')).toBeNull();
      expect(parsePostEventFollowupButton('pef_schedule:abc')).toBeNull();
      expect(parsePostEventFollowupButton('pef_schedule')).toBeNull();
    });

    it('lookupFollowupEvent returns the row shape, null when missing', async () => {
      const creator = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id, {
        gameId: testApp.seed.game.id,
      });
      expect(await lookupFollowupEvent(testApp.db, ev.id)).toEqual({
        id: ev.id,
        title: 'Ended Event',
        creatorId: creator.id,
        gameId: testApp.seed.game.id,
      });
      expect(await lookupFollowupEvent(testApp.db, 999_999)).toBeNull();
    });
  });

  // =================================================================
  // M3 — Organizer prompt (PostEventFollowupPromptService.sendOrganizerPrompt)
  // =================================================================
  describe('M3 organizer prompt rendering + gating', () => {
    let sendEmbedDM: jest.Mock;
    let promptService: PostEventFollowupPromptService;

    beforeEach(() => {
      sendEmbedDM = jest.fn().mockResolvedValue(undefined);
      promptService = new PostEventFollowupPromptService(testApp.db, {
        sendEmbedDM,
      } as unknown as DiscordBotClientService);
    });

    const sentButtons = (): { custom_id: string; label: string }[] => {
      const row = sendEmbedDM.mock.calls[0][2] as {
        components: { toJSON(): { custom_id: string; label: string } }[];
      };
      return row.components.map((c) => c.toJSON());
    };

    it('M3-AC3: renders both buttons when the event has a game', async () => {
      const creator = await mkUser(testApp);
      await promptService.sendOrganizerPrompt({
        id: 501,
        title: 'Raid',
        creator_id: creator.id,
        game_id: testApp.seed.game.id,
      });
      expect(sendEmbedDM).toHaveBeenCalledTimes(1);
      const buttons = sentButtons();
      expect(buttons.map((b) => b.custom_id)).toEqual([
        'pef_schedule:501',
        'pef_poll:501',
      ]);
      expect(buttons.map((b) => b.label)).toEqual([
        'Schedule event',
        'Start a poll',
      ]);
    });

    it('M3-AC3: omits the poll button when the event has no game', async () => {
      const creator = await mkUser(testApp);
      await promptService.sendOrganizerPrompt({
        id: 502,
        title: 'Casual',
        creator_id: creator.id,
        game_id: null,
      });
      expect(sendEmbedDM).toHaveBeenCalledTimes(1);
      const buttons = sentButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0].custom_id).toBe('pef_schedule:502');
    });

    it('M3-AC1: no prompt when the organizer opted out of post_event_followup discord', async () => {
      const creator = await mkUser(testApp);
      await optOutFollowupDiscord(testApp, creator.id);
      await promptService.sendOrganizerPrompt({
        id: 503,
        title: 'Raid',
        creator_id: creator.id,
        game_id: testApp.seed.game.id,
      });
      expect(sendEmbedDM).not.toHaveBeenCalled();
    });

    it.each([
      ['banned', { bannedAt: new Date() }],
      ['kicked', { kickedAt: new Date() }],
      ['deactivated', { deactivatedAt: new Date() }],
      ['unlinked', { discordId: null }],
    ] as const)(
      'M3-AC2: no prompt when the organizer is %s',
      async (_label, overrides) => {
        const creator = await mkUser(testApp, overrides);
        await promptService.sendOrganizerPrompt({
          id: 504,
          title: 'Raid',
          creator_id: creator.id,
          game_id: testApp.seed.game.id,
        });
        expect(sendEmbedDM).not.toHaveBeenCalled();
      },
    );
  });

  // =================================================================
  // M3 — [Schedule event] handler (deep-link, creates nothing)
  // =================================================================
  describe('M3 handleScheduleClick', () => {
    it('M3-AC5: replies with a deep-link, creates nothing, leaves sentinels untouched', async () => {
      const creator = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id, {
        gameId: testApp.seed.game.id,
      });
      await insertSentinel(testApp, ev.id);
      const deps = makeDeps(testApp);
      const interaction = mockInteraction();
      const before = await countEvents(testApp);

      await handleScheduleClick(deps, interaction, evShape(ev));

      const reply = interaction.editReply.mock.calls[0][0].content as string;
      expect(reply).toContain('https://app.test/events/new?');
      expect(reply).toContain(`followupForEventId=${ev.id}`);
      expect(reply).toContain(`gameId=${testApp.seed.game.id}`);
      expect(await countEvents(testApp)).toBe(before);
      expect(deps.create).not.toHaveBeenCalled();
      expect(deps.createMany).not.toHaveBeenCalled();
      const sentinel = await getSentinel(testApp, ev.id);
      expect(sentinel.choice).toBeNull();
      expect(sentinel.attendeesNotifiedAt).toBeNull();
    });

    it('M3-AC5: omits gameId in the link when the event has no game', async () => {
      const creator = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id, { gameId: null });
      await insertSentinel(testApp, ev.id);
      const deps = makeDeps(testApp);
      const interaction = mockInteraction();

      await handleScheduleClick(deps, interaction, evShape(ev));

      const reply = interaction.editReply.mock.calls[0][0].content as string;
      expect(reply).toContain(`followupForEventId=${ev.id}`);
      expect(reply).not.toContain('gameId=');
    });

    it('M3-AC6: two clicks each return the link and never lock the sentinel', async () => {
      const creator = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id, {
        gameId: testApp.seed.game.id,
      });
      await insertSentinel(testApp, ev.id);
      const deps = makeDeps(testApp);
      const interaction = mockInteraction();

      await handleScheduleClick(deps, interaction, evShape(ev));
      await handleScheduleClick(deps, interaction, evShape(ev));

      expect(interaction.editReply).toHaveBeenCalledTimes(2);
      const sentinel = await getSentinel(testApp, ev.id);
      expect(sentinel.choice).toBeNull();
      expect(sentinel.attendeesNotifiedAt).toBeNull();
    });
  });

  // =================================================================
  // M3 — [Start a poll] handler (no linkedEventId, single-fire, rollback)
  // =================================================================
  describe('M3 handlePollClick', () => {
    async function setupPoll(gameId: number | null) {
      const creator = await mkUser(testApp);
      const a = await mkUser(testApp);
      const b = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id, { gameId });
      await mkSignup(testApp, ev.id, a.id, 'signed_up');
      await mkSignup(testApp, ev.id, b.id, 'tentative');
      await insertSentinel(testApp, ev.id);
      return { creator, recipients: [a.id, b.id], ev };
    }

    it('M3-AC7: creates the poll with {gameId, memberUserIds}, NO linkedEventId, no RESCHEDULING flip', async () => {
      const gameId = testApp.seed.game.id;
      const { creator, recipients, ev } = await setupPoll(gameId);
      const create = jest
        .fn()
        .mockResolvedValue(pollResponse(gameId, { id: 555, lineupId: 111 }));
      const deps = makeDeps(testApp, { create });

      await handlePollClick(deps, mockInteraction(), evShape(ev));

      expect(create).toHaveBeenCalledTimes(1);
      const [input, actingUserId] = create.mock.calls[0];
      expect(input).not.toHaveProperty('linkedEventId');
      expect(input.gameId).toBe(gameId);
      expect([...input.memberUserIds].sort()).toEqual([...recipients].sort());
      expect(actingUserId).toBe(creator.id);
      const row = await getEvent(testApp, ev.id);
      expect(row.reschedulingPollId).toBeNull();
      const sentinel = await getSentinel(testApp, ev.id);
      expect(sentinel.choice).toBe('poll');
      expect(sentinel.attendeesNotifiedAt).not.toBeNull();
    });

    it('M3-AC7: fan-out uses the poll payload {lineupId, matchId}', async () => {
      const gameId = testApp.seed.game.id;
      const { ev } = await setupPoll(gameId);
      const create = jest
        .fn()
        .mockResolvedValue(pollResponse(gameId, { id: 555, lineupId: 111 }));
      const deps = makeDeps(testApp, { create });

      await handlePollClick(deps, mockInteraction(), evShape(ev));

      expect(deps.createMany).toHaveBeenCalledTimes(1);
      const inputs = deps.createMany.mock.calls[0][0];
      expect(inputs[0].payload).toEqual({
        lineupId: 111,
        matchId: 555,
        subtype: 'post_event_poll',
      });
    });

    it('M3-AC8: a second click is a single-fire no-op (already picked)', async () => {
      const gameId = testApp.seed.game.id;
      const { ev } = await setupPoll(gameId);
      const create = jest
        .fn()
        .mockResolvedValue(pollResponse(gameId, { id: 555, lineupId: 111 }));
      const deps = makeDeps(testApp, { create });

      await handlePollClick(deps, mockInteraction(), evShape(ev));
      const second = mockInteraction();
      await handlePollClick(deps, second, evShape(ev));

      expect(create).toHaveBeenCalledTimes(1);
      expect(deps.createMany).toHaveBeenCalledTimes(1);
      expect(second.editReply.mock.calls[0][0].content).toMatch(
        /already picked/i,
      );
    });

    it('M3-AC9: create failure rolls choice back and a retry succeeds', async () => {
      const gameId = testApp.seed.game.id;
      const { ev } = await setupPoll(gameId);
      const create = jest
        .fn()
        .mockRejectedValueOnce(new Error('Game not found'))
        .mockResolvedValueOnce(pollResponse(gameId, { id: 9, lineupId: 8 }));
      const deps = makeDeps(testApp, { create });

      const first = mockInteraction();
      await handlePollClick(deps, first, evShape(ev));
      expect(first.editReply.mock.calls[0][0].content).toMatch(/try again/i);
      expect(deps.createMany).not.toHaveBeenCalled();
      let sentinel = await getSentinel(testApp, ev.id);
      expect(sentinel.choice).toBeNull();
      expect(sentinel.attendeesNotifiedAt).toBeNull();

      await handlePollClick(deps, mockInteraction(), evShape(ev));
      expect(create).toHaveBeenCalledTimes(2);
      expect(deps.createMany).toHaveBeenCalledTimes(1);
      sentinel = await getSentinel(testApp, ev.id);
      expect(sentinel.choice).toBe('poll');
    });

    it('poll path is guarded when the event has no game', async () => {
      const { ev } = await setupPoll(null);
      const deps = makeDeps(testApp);
      const interaction = mockInteraction();

      await handlePollClick(deps, interaction, evShape(ev));

      expect(deps.create).not.toHaveBeenCalled();
      expect(deps.createMany).not.toHaveBeenCalled();
      const sentinel = await getSentinel(testApp, ev.id);
      expect(sentinel.choice).toBeNull();
    });
  });

  // =================================================================
  // M3 — listener route gate (only the organizer may act)
  // =================================================================
  describe('M3 route gating (non-organizer rejected)', () => {
    const routeOf = (
      listener: PostEventFollowupInteractionListener,
    ): ((i: unknown, p: unknown) => Promise<void>) =>
      (
        listener as unknown as {
          route: (i: unknown, p: unknown) => Promise<void>;
        }
      ).route.bind(listener);

    it('M3-AC4: a non-organizer clicker is rejected with no state change', async () => {
      const creator = await mkUser(testApp);
      const stranger = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id, {
        gameId: testApp.seed.game.id,
      });
      await insertSentinel(testApp, ev.id);
      const listener = testApp.app.get(PostEventFollowupInteractionListener);
      const interaction = mockInteraction();
      (interaction as unknown as { user: { id: string } }).user = {
        id: stranger.discordId!,
      };

      await routeOf(listener)(interaction, {
        action: 'pef_poll',
        endedEventId: ev.id,
      });

      expect(interaction.editReply.mock.calls[0][0].content).toMatch(
        /only the organizer/i,
      );
      const sentinel = await getSentinel(testApp, ev.id);
      expect(sentinel.choice).toBeNull();
      expect(sentinel.attendeesNotifiedAt).toBeNull();
    });

    it('replies "Event not found" when the ended event is gone', async () => {
      const clicker = await mkUser(testApp);
      const listener = testApp.app.get(PostEventFollowupInteractionListener);
      const interaction = mockInteraction();
      (interaction as unknown as { user: { id: string } }).user = {
        id: clicker.discordId!,
      };

      await routeOf(listener)(interaction, {
        action: 'pef_schedule',
        endedEventId: 987_654,
      });

      expect(interaction.editReply.mock.calls[0][0].content).toMatch(
        /not found/i,
      );
    });
  });

  // =================================================================
  // M4 — runFollowupFanout (shared exactly-once attendee fan-out)
  // =================================================================
  describe('M4 runFollowupFanout', () => {
    async function fanoutFixture() {
      const creator = await mkUser(testApp);
      const a = await mkUser(testApp);
      const b = await mkUser(testApp);
      const declined = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id);
      await mkSignup(testApp, ev.id, creator.id, 'signed_up');
      await mkSignup(testApp, ev.id, a.id, 'signed_up');
      await mkSignup(testApp, ev.id, b.id, 'tentative');
      await mkSignup(testApp, ev.id, declined.id, 'declined');
      return { creator, recipients: [a.id, b.id], ev };
    }

    it('M4-AC1/AC3: fans out to the rostered set (event payload), excludes the organizer, stamps the claim', async () => {
      const { creator, recipients, ev } = await fanoutFixture();
      await insertSentinel(testApp, ev.id);
      const createMany = jest.fn().mockResolvedValue([]);

      await runFollowupFanout(
        { db: testApp.db, notificationService: { createMany } },
        ev.id,
        { eventId: 4242 },
        creator.id,
      );

      expect(createMany).toHaveBeenCalledTimes(1);
      const inputs = createMany.mock.calls[0][0] as Array<{
        userId: number;
        type: string;
        payload: unknown;
      }>;
      expect(inputs.map((i) => i.userId).sort()).toEqual(
        [...recipients].sort(),
      );
      expect(inputs.map((i) => i.userId)).not.toContain(creator.id);
      expect(inputs.every((i) => i.type === 'post_event_followup')).toBe(true);
      expect(inputs[0].payload).toEqual({ eventId: 4242 });
      expect(
        (await getSentinel(testApp, ev.id)).attendeesNotifiedAt,
      ).not.toBeNull();
    });

    it('M4-AC6/AC9: exactly-once across paths (poll then event → single fan-out)', async () => {
      const { creator, ev } = await fanoutFixture();
      await insertSentinel(testApp, ev.id);
      const createMany = jest.fn().mockResolvedValue([]);
      const deps = {
        db: testApp.db,
        notificationService: { createMany } as never,
      };

      await runFollowupFanout(
        deps,
        ev.id,
        { lineupId: 1, matchId: 2, subtype: 'post_event_poll' },
        creator.id,
      );
      const stampedAt = (await getSentinel(testApp, ev.id)).attendeesNotifiedAt;
      await runFollowupFanout(deps, ev.id, { eventId: 4242 }, creator.id);

      expect(createMany).toHaveBeenCalledTimes(1);
      expect((await getSentinel(testApp, ev.id)).attendeesNotifiedAt).toEqual(
        stampedAt,
      );
    });

    it('M4-AC7: a creator mismatch (forged followupForEventId) fans out nothing and rolls the claim back', async () => {
      const { creator, ev } = await fanoutFixture();
      await insertSentinel(testApp, ev.id);
      const createMany = jest.fn().mockResolvedValue([]);

      await runFollowupFanout(
        { db: testApp.db, notificationService: { createMany } },
        ev.id,
        { eventId: 4242 },
        creator.id + 9999,
      );

      expect(createMany).not.toHaveBeenCalled();
      expect(
        (await getSentinel(testApp, ev.id)).attendeesNotifiedAt,
      ).toBeNull();
    });

    it('M4-AC8: no sentinel row (no prompt ever sent) → no fan-out, no throw', async () => {
      const { creator, ev } = await fanoutFixture();
      const createMany = jest.fn().mockResolvedValue([]);

      await runFollowupFanout(
        { db: testApp.db, notificationService: { createMany } },
        ev.id,
        { eventId: 4242 },
        creator.id,
      );

      expect(createMany).not.toHaveBeenCalled();
      expect(await getSentinel(testApp, ev.id)).toBeUndefined();
    });

    it('rolls the claim back and rethrows when createMany fails', async () => {
      const { creator, ev } = await fanoutFixture();
      await insertSentinel(testApp, ev.id);
      const createMany = jest.fn().mockRejectedValue(new Error('boom'));

      await expect(
        runFollowupFanout(
          { db: testApp.db, notificationService: { createMany } },
          ev.id,
          { eventId: 4242 },
          creator.id,
        ),
      ).rejects.toThrow('boom');

      expect(
        (await getSentinel(testApp, ev.id)).attendeesNotifiedAt,
      ).toBeNull();
    });

    it('M4-AC1: inserts real post_event_followup notification rows for recipients only', async () => {
      const { creator, recipients, ev } = await fanoutFixture();
      await insertSentinel(testApp, ev.id);
      const notificationService = testApp.app.get(NotificationService);

      await runFollowupFanout(
        { db: testApp.db, notificationService },
        ev.id,
        { eventId: 4242 },
        creator.id,
      );

      const rows = await testApp.db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.type, 'post_event_followup'));
      expect(rows.map((r) => r.userId).sort()).toEqual([...recipients].sort());
      expect(rows.map((r) => r.userId)).not.toContain(creator.id);
      expect(rows[0].payload).toEqual({ eventId: 4242 });
    });
  });
});

/** Map a raw events row to the FollowupInteractionEvent handler shape. */
function evShape(ev: {
  id: number;
  title: string;
  creatorId: number;
  gameId: number | null;
}): FollowupInteractionEvent {
  return {
    id: ev.id,
    title: ev.title,
    creatorId: ev.creatorId,
    gameId: ev.gameId,
  };
}
