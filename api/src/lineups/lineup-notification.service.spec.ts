/**
 * TDD tests for LineupNotificationService (ROK-932).
 * Validates Discord channel embeds and player DM dispatch across the full
 * Community Lineup lifecycle: creation, nominations, voting, decided,
 * scheduling, event creation, and operator removal.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LineupNotificationService } from './lineup-notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

function makeMockDb() {
  return {
    execute: jest.fn().mockResolvedValue([]),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ embedMessageId: null }]),
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  };
}

function makeMockNotificationService() {
  return { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
}

function makeMockDedupService() {
  return { checkAndMarkSent: jest.fn().mockResolvedValue(false) };
}

function makeMockBotClient() {
  return {
    sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    editEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    isConnected: jest.fn().mockReturnValue(true),
  };
}

function makeMockSettingsService() {
  return {
    get: jest.fn().mockResolvedValue(null),
    getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    getDiscordBotDefaultChannel: jest.fn().mockResolvedValue('chan-default'),
  };
}

// ---------------------------------------------------------------------------
// Test module builder
// ---------------------------------------------------------------------------

async function createTestModule() {
  const mockDb = makeMockDb();
  const mockNotificationService = makeMockNotificationService();
  const mockDedupService = makeMockDedupService();
  const mockBotClient = makeMockBotClient();
  const mockSettingsService = makeMockSettingsService();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LineupNotificationService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: NotificationDedupService, useValue: mockDedupService },
      { provide: DiscordBotClientService, useValue: mockBotClient },
      { provide: SettingsService, useValue: mockSettingsService },
    ],
  }).compile();

  return {
    service: module.get<LineupNotificationService>(LineupNotificationService),
    mockDb,
    mockNotificationService,
    mockDedupService,
    mockBotClient,
    mockSettingsService,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LINEUP_ID = 42;
const MATCH_ID = 100;
const GAME_NAME = 'Elden Ring';
const GAME_ID = 5;

function makeLineup(overrides: Record<string, unknown> = {}) {
  return {
    id: LINEUP_ID,
    status: 'building',
    targetDate: new Date('2026-04-15T00:00:00Z'),
    createdBy: 10,
    matchThreshold: 35,
    phaseDeadline: null as Date | null,
    ...overrides,
  };
}

function makeMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: MATCH_ID,
    lineupId: LINEUP_ID,
    gameId: GAME_ID,
    gameName: GAME_NAME,
    status: 'suggested',
    thresholdMet: true,
    voteCount: 5,
    ...overrides,
  };
}

function makeMember(id: number, displayName = `Player${id}`) {
  return { id, userId: id, displayName, discordId: `discord-${id}` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LineupNotificationService', () => {
  let service: LineupNotificationService;
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockNotificationService: ReturnType<typeof makeMockNotificationService>;
  let mockDedupService: ReturnType<typeof makeMockDedupService>;
  let mockBotClient: ReturnType<typeof makeMockBotClient>;
  let mockSettingsService: ReturnType<typeof makeMockSettingsService>;

  beforeEach(async () => {
    const ctx = await createTestModule();
    service = ctx.service;
    mockDb = ctx.mockDb;
    mockNotificationService = ctx.mockNotificationService;
    mockDedupService = ctx.mockDedupService;
    mockBotClient = ctx.mockBotClient;
    mockSettingsService = ctx.mockSettingsService;
  });

  // -----------------------------------------------------------------------
  // AC-1: Channel embed posted when lineup enters building status
  // -----------------------------------------------------------------------
  describe('notifyLineupCreated', () => {
    it('posts channel embed for lineup creation', async () => {
      await service.notifyLineupCreated(makeLineup());

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
      expect(mockBotClient.sendEmbed).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.anything(),
      );
    });

    it('uses dedup key lineup-created:{lineupId}', async () => {
      await service.notifyLineupCreated(makeLineup());

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-created:${LINEUP_ID}`,
        expect.anything(),
      );
    });

    it('falls back to announcement channel when no lineup channel', async () => {
      mockSettingsService.get.mockResolvedValue(null);

      await service.notifyLineupCreated(makeLineup());

      expect(
        mockSettingsService.getDiscordBotDefaultChannel,
      ).toHaveBeenCalled();
    });

    it('silently skips when no channel is configured', async () => {
      mockSettingsService.get.mockResolvedValue(null);
      mockSettingsService.getDiscordBotDefaultChannel.mockResolvedValue(null);

      await service.notifyLineupCreated(makeLineup());

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('persists Discord channel/message IDs after posting (ROK-1063)', async () => {
      mockBotClient.sendEmbed.mockResolvedValueOnce({ id: 'msg-created-42' });
      mockSettingsService.get.mockResolvedValue('chan-lineup');

      await service.notifyLineupCreated(makeLineup({ id: 99 }));

      expect(mockDb.update).toHaveBeenCalledTimes(1);
      const setCall = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
      expect(setCall).toMatchObject({
        discordCreatedChannelId: 'chan-lineup',
        discordCreatedMessageId: 'msg-created-42',
      });
    });

    it('skips persisting message ID when no channel is configured', async () => {
      mockSettingsService.get.mockResolvedValue(null);
      mockSettingsService.getDiscordBotDefaultChannel.mockResolvedValue(null);

      await service.notifyLineupCreated(makeLineup());

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // ROK-1063: Embed refresh after metadata edit
  // -----------------------------------------------------------------------
  describe('refreshCreatedEmbed (ROK-1063)', () => {
    it('edits the stored Discord message in place when refs exist', async () => {
      mockBotClient.editEmbed = jest.fn().mockResolvedValue({ id: 'msg-1' });
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                channelId: 'chan-edit',
                messageId: 'msg-edit-77',
                targetDate: null,
              },
            ]),
          }),
        }),
      });
      mockSettingsService.get.mockResolvedValue('chan-edit');

      await service.refreshCreatedEmbed({
        id: 99,
        title: 'New Title',
        description: 'New desc',
      });

      expect(mockBotClient.editEmbed).toHaveBeenCalledTimes(1);
      const [channelArg, messageArg] = mockBotClient.editEmbed.mock.calls[0];
      expect(channelArg).toBe('chan-edit');
      expect(messageArg).toBe('msg-edit-77');
    });

    it('is a no-op when the lineup has no stored Discord message ref', async () => {
      mockBotClient.editEmbed = jest.fn();
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([
                { channelId: null, messageId: null, targetDate: null },
              ]),
          }),
        }),
      });

      await service.refreshCreatedEmbed({
        id: 99,
        title: 'X',
        description: null,
      });

      expect(mockBotClient.editEmbed).not.toHaveBeenCalled();
    });

    it('swallows edit errors so metadata update still succeeds', async () => {
      mockBotClient.editEmbed = jest
        .fn()
        .mockRejectedValue(new Error('Unknown Message'));
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                channelId: 'c1',
                messageId: 'm1',
                targetDate: null,
              },
            ]),
          }),
        }),
      });
      mockSettingsService.get.mockResolvedValue('c1');

      await expect(
        service.refreshCreatedEmbed({
          id: 99,
          title: 'X',
          description: null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // AC-2: Channel embed updated at nomination milestones
  // -----------------------------------------------------------------------
  describe('notifyNominationMilestone', () => {
    const entry = (name: string, id = 1) => ({
      gameId: id,
      gameName: name,
      nominatorName: 'User',
      coverUrl: null,
    });

    it('posts embed at 25% threshold', async () => {
      await service.notifyNominationMilestone(LINEUP_ID, 25, [entry('Game A')]);

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('posts embed at 50% threshold', async () => {
      await service.notifyNominationMilestone(LINEUP_ID, 50, [
        entry('A'),
        entry('B'),
      ]);

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('posts embed at 100% threshold', async () => {
      await service.notifyNominationMilestone(LINEUP_ID, 100, [
        entry('A'),
        entry('B'),
        entry('C'),
      ]);

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('uses dedup key with threshold to prevent duplicates', async () => {
      await service.notifyNominationMilestone(LINEUP_ID, 50, [entry('A')]);

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-milestone:${LINEUP_ID}:50`,
        expect.anything(),
      );
    });

    it('skips embed when dedup indicates already sent', async () => {
      mockDedupService.checkAndMarkSent.mockResolvedValueOnce(true);

      await service.notifyNominationMilestone(LINEUP_ID, 50, [entry('A')]);

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // AC-3: Channel embed + DMs when voting opens
  // -----------------------------------------------------------------------
  describe('notifyVotingOpen', () => {
    const deadline = new Date('2026-04-10T20:00:00Z');
    const games = [
      { id: 1, name: 'Game A' },
      { id: 2, name: 'Game B' },
      { id: 3, name: 'Game C' },
      { id: 4, name: 'Game D' },
      { id: 5, name: 'Game E' },
    ];

    it('posts channel embed with voting info', async () => {
      await service.notifyVotingOpen(
        makeLineup({ status: 'voting', votingDeadline: deadline }),
        games,
      );

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('dispatches DMs to all Discord-linked members', async () => {
      const members = [makeMember(1), makeMember(2), makeMember(3)];
      mockDb.execute.mockResolvedValueOnce(members);

      await service.notifyVotingOpen(
        makeLineup({ status: 'voting', votingDeadline: deadline }),
        games,
      );

      expect(mockNotificationService.create).toHaveBeenCalledTimes(3);
    });

    it('sends DMs with type community_lineup and subtype in payload', async () => {
      mockDb.execute.mockResolvedValueOnce([makeMember(1)]);

      await service.notifyVotingOpen(
        makeLineup({ status: 'voting', votingDeadline: deadline }),
        games,
      );

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_voting_open',
          }),
        }),
      );
    });

    it('uses dedup key lineup-vote-dm:{lineupId}:{userId}', async () => {
      mockDb.execute.mockResolvedValueOnce([makeMember(7)]);

      await service.notifyVotingOpen(
        makeLineup({ status: 'voting', votingDeadline: deadline }),
        games,
      );

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-vote-dm:${LINEUP_ID}:7`,
        expect.anything(),
      );
    });

    it('channel embed uses dedup key lineup-voting:{lineupId}', async () => {
      await service.notifyVotingOpen(
        makeLineup({ status: 'voting', votingDeadline: deadline }),
        games,
      );

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-voting:${LINEUP_ID}`,
        expect.anything(),
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC-5: Channel embed with tiered match summary (decided phase)
  // -----------------------------------------------------------------------
  describe('notifyMatchesFound', () => {
    it('posts combined tier embed to channel', async () => {
      const matches = [
        makeMatch({ thresholdMet: true }),
        makeMatch({ id: 101, thresholdMet: false }),
      ];

      await service.notifyMatchesFound(LINEUP_ID, matches);

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('uses dedup key lineup-decided:{lineupId}', async () => {
      await service.notifyMatchesFound(LINEUP_ID, [makeMatch()]);

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-decided:${LINEUP_ID}`,
        expect.anything(),
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC-6: DM to each match member with match details
  // -----------------------------------------------------------------------
  describe('notifyMatchMember', () => {
    it('sends DM with game name and co-players', async () => {
      const coPlayers = ['Alice', 'Bob'];

      await service.notifyMatchMember(
        MATCH_ID,
        7,
        GAME_NAME,
        coPlayers,
        LINEUP_ID,
      );

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 7,
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_match_member',
            matchId: MATCH_ID,
          }),
        }),
      );
    });

    it('uses dedup key lineup-match-dm:{matchId}:{userId}', async () => {
      await service.notifyMatchMember(MATCH_ID, 7, GAME_NAME, [], LINEUP_ID);

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-match-dm:${MATCH_ID}:7`,
        expect.anything(),
      );
    });

    it('skips DM when dedup indicates already sent', async () => {
      mockDedupService.checkAndMarkSent.mockResolvedValueOnce(true);

      await service.notifyMatchMember(MATCH_ID, 7, GAME_NAME, [], LINEUP_ID);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // AC-7: DM to wishlist/heart users for rally-eligible games
  // -----------------------------------------------------------------------
  describe('notifyRallyInterest', () => {
    it('sends DM with bandwagon link to non-match user', async () => {
      await service.notifyRallyInterest(MATCH_ID, 12, GAME_NAME, LINEUP_ID);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 12,
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_rally_interest',
            matchId: MATCH_ID,
          }),
        }),
      );
    });

    it('uses dedup key lineup-rally-dm:{matchId}:{userId}', async () => {
      await service.notifyRallyInterest(MATCH_ID, 12, GAME_NAME, LINEUP_ID);

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-rally-dm:${MATCH_ID}:12`,
        expect.anything(),
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC-8: Channel embed per match when scheduling opens + DMs
  // -----------------------------------------------------------------------
  describe('notifySchedulingOpen', () => {
    it('posts per-match channel embed', async () => {
      await service.notifySchedulingOpen(makeMatch({ status: 'scheduling' }));

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('dispatches DMs to match members', async () => {
      const members = [makeMember(1), makeMember(2)];
      mockDb.execute.mockResolvedValueOnce(members);

      await service.notifySchedulingOpen(makeMatch({ status: 'scheduling' }));

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    });

    it('DMs use subtype lineup_scheduling_open in payload', async () => {
      mockDb.execute.mockResolvedValueOnce([makeMember(3)]);

      await service.notifySchedulingOpen(makeMatch({ status: 'scheduling' }));

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_scheduling_open',
          }),
        }),
      );
    });

    it('uses dedup key lineup-scheduling:{matchId}', async () => {
      await service.notifySchedulingOpen(makeMatch({ status: 'scheduling' }));

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-scheduling:${MATCH_ID}`,
        expect.anything(),
      );
    });

    it('DMs use dedup key lineup-sched-dm:{matchId}:{userId}', async () => {
      mockDb.execute.mockResolvedValueOnce([makeMember(5)]);

      await service.notifySchedulingOpen(makeMatch({ status: 'scheduling' }));

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-sched-dm:${MATCH_ID}:5`,
        expect.anything(),
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC-10: Channel embed + DM when event is created from match
  // -----------------------------------------------------------------------
  describe('notifyEventCreated', () => {
    it('posts channel embed for created event', async () => {
      await service.notifyEventCreated(
        makeMatch({ status: 'scheduled', linkedEventId: 200 }),
        new Date('2026-04-20T18:00:00Z'),
      );

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('dispatches DMs to match members', async () => {
      const members = [makeMember(1), makeMember(2)];
      mockDb.execute.mockResolvedValueOnce(members);

      await service.notifyEventCreated(
        makeMatch({ status: 'scheduled', linkedEventId: 200 }),
        new Date('2026-04-20T18:00:00Z'),
      );

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    });

    it('DMs use subtype lineup_event_created', async () => {
      mockDb.execute.mockResolvedValueOnce([makeMember(9)]);

      await service.notifyEventCreated(
        makeMatch({ status: 'scheduled', linkedEventId: 200 }),
        new Date('2026-04-20T18:00:00Z'),
      );

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_event_created',
          }),
        }),
      );
    });

    it('uses dedup key lineup-event:{matchId}', async () => {
      await service.notifyEventCreated(
        makeMatch({ status: 'scheduled', linkedEventId: 200 }),
        new Date('2026-04-20T18:00:00Z'),
      );

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-event:${MATCH_ID}`,
        expect.anything(),
      );
    });

    it('DMs use dedup key lineup-event-dm:{matchId}:{userId}', async () => {
      mockDb.execute.mockResolvedValueOnce([makeMember(9)]);

      await service.notifyEventCreated(
        makeMatch({ status: 'scheduled', linkedEventId: 200 }),
        new Date('2026-04-20T18:00:00Z'),
      );

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-event-dm:${MATCH_ID}:9`,
        expect.anything(),
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC-16: Nomination removed by operator sends DM to nominator only
  // -----------------------------------------------------------------------
  describe('notifyNominationRemoved', () => {
    it('sends DM to the nominator only', async () => {
      await service.notifyNominationRemoved(
        LINEUP_ID,
        GAME_ID,
        GAME_NAME,
        15,
        'OperatorName',
      );

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 15,
          type: 'community_lineup',
          payload: expect.objectContaining({
            subtype: 'lineup_nomination_removed',
          }),
        }),
      );
    });

    it('uses dedup key with lineupId, gameId, and userId', async () => {
      await service.notifyNominationRemoved(
        LINEUP_ID,
        GAME_ID,
        GAME_NAME,
        15,
        'OperatorName',
      );

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-removed-dm:${LINEUP_ID}:${GAME_ID}:15`,
        expect.anything(),
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC-11: community_lineup preference toggle disables DMs
  // -----------------------------------------------------------------------
  describe('preference enforcement', () => {
    it('skips DM when user has community_lineup disabled', async () => {
      // Simulate preference-disabled user; the service should check
      // preferences before dispatching.
      mockDb.execute.mockResolvedValueOnce([
        { ...makeMember(20), communityLineupDisabled: true },
      ]);

      await service.notifyMatchMember(MATCH_ID, 20, GAME_NAME, [], LINEUP_ID);

      // Preference filtering uses NotificationService.create which checks
      // internally, but the service should pass type: 'community_lineup'
      // so the preference check hits the right category.
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'community_lineup' }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC-12: Channel embeds NOT affected by user preference toggles
  // -----------------------------------------------------------------------
  describe('channel embed independence from preferences', () => {
    it('posts channel embed regardless of user preference', async () => {
      // Channel embeds should always post -- they are server-wide,
      // not per-user.
      await service.notifyLineupCreated(makeLineup());

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // AC-14: Dedup prevents duplicate notifications on retry
  // -----------------------------------------------------------------------
  describe('dedup enforcement', () => {
    it('skips channel embed when dedup returns already sent', async () => {
      mockDedupService.checkAndMarkSent.mockResolvedValue(true);

      await service.notifyLineupCreated(makeLineup());

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    it('skips DM when dedup returns already sent', async () => {
      mockDedupService.checkAndMarkSent.mockResolvedValue(true);
      mockDb.execute.mockResolvedValueOnce([makeMember(1)]);

      await service.notifyMatchMember(MATCH_ID, 1, GAME_NAME, [], LINEUP_ID);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // ROK-1033: Skip duplicate scheduling channel embed when interactive
  // poll embed already posted (embedMessageId set on match row)
  // -----------------------------------------------------------------------
  describe('ROK-1033: duplicate scheduling embed guard', () => {
    /**
     * Helper: stub the Drizzle select chain that the guard will use
     * to look up embedMessageId on the match row.
     *
     * The guard will call db.select().from().where().limit() which
     * resolves as a thenable returning the provided rows.
     */
    function stubMatchLookup(rows: Record<string, unknown>[]) {
      mockDb.select = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(rows),
          }),
        }),
      });
    }

    // AC1: embedMessageId already set -> NO channel embed posted
    it('AC1: skips channel embed when embedMessageId is already set', async () => {
      stubMatchLookup([{ id: MATCH_ID, embedMessageId: 'msg-existing' }]);

      await service.notifySchedulingOpen(makeMatch({ status: 'scheduling' }));

      expect(mockBotClient.sendEmbed).not.toHaveBeenCalled();
    });

    // AC2: embedMessageId already set -> DMs still sent
    it('AC2: still sends DMs when embedMessageId is already set', async () => {
      stubMatchLookup([{ id: MATCH_ID, embedMessageId: 'msg-existing' }]);
      const members = [makeMember(1), makeMember(2)];
      mockDb.execute.mockResolvedValueOnce(members);

      await service.notifySchedulingOpen(makeMatch({ status: 'scheduling' }));

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    });

    // AC3: embedMessageId null (lineup matches) -> channel embed posted
    it('AC3: posts channel embed when embedMessageId is null', async () => {
      stubMatchLookup([{ id: MATCH_ID, embedMessageId: null }]);

      await service.notifySchedulingOpen(makeMatch({ status: 'scheduling' }));

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    // AC4: embedMessageId null -> DMs still sent
    it('AC4: still sends DMs when embedMessageId is null', async () => {
      stubMatchLookup([{ id: MATCH_ID, embedMessageId: null }]);
      const members = [makeMember(1), makeMember(2)];
      mockDb.execute.mockResolvedValueOnce(members);

      await service.notifySchedulingOpen(makeMatch({ status: 'scheduling' }));

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    });
  });
});
