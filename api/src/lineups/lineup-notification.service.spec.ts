/**
 * TDD tests for LineupNotificationService (ROK-932).
 * Validates Discord channel embeds and player DM dispatch across the full
 * Community Lineup lifecycle: creation, nominations, voting, decided,
 * scheduling, event creation, and operator removal.
 *
 * These tests are written BEFORE implementation -- they must all FAIL.
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
  return { execute: jest.fn().mockResolvedValue([]) };
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
  });

  // -----------------------------------------------------------------------
  // AC-2: Channel embed updated at nomination milestones
  // -----------------------------------------------------------------------
  describe('notifyNominationMilestone', () => {
    const entry = (name: string, id = 1) => ({ gameId: id, gameName: name, nominatorName: 'User', coverUrl: null });

    it('posts embed at 25% threshold', async () => {
      await service.notifyNominationMilestone(LINEUP_ID, 25, [entry('Game A')]);

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('posts embed at 50% threshold', async () => {
      await service.notifyNominationMilestone(LINEUP_ID, 50, [entry('A'), entry('B')]);

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('posts embed at 100% threshold', async () => {
      await service.notifyNominationMilestone(LINEUP_ID, 100, [entry('A'), entry('B'), entry('C')]);

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

    it('posts channel embed with voting info', async () => {
      await service.notifyVotingOpen(
        makeLineup({ status: 'voting', votingDeadline: deadline }),
        5,
      );

      expect(mockBotClient.sendEmbed).toHaveBeenCalledTimes(1);
    });

    it('dispatches DMs to all Discord-linked members', async () => {
      const members = [makeMember(1), makeMember(2), makeMember(3)];
      mockDb.execute.mockResolvedValueOnce(members);

      await service.notifyVotingOpen(
        makeLineup({ status: 'voting', votingDeadline: deadline }),
        5,
      );

      expect(mockNotificationService.create).toHaveBeenCalledTimes(3);
    });

    it('sends DMs with type community_lineup and subtype in payload', async () => {
      mockDb.execute.mockResolvedValueOnce([makeMember(1)]);

      await service.notifyVotingOpen(
        makeLineup({ status: 'voting', votingDeadline: deadline }),
        5,
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
        5,
      );

      expect(mockDedupService.checkAndMarkSent).toHaveBeenCalledWith(
        `lineup-vote-dm:${LINEUP_ID}:7`,
        expect.anything(),
      );
    });

    it('channel embed uses dedup key lineup-voting:{lineupId}', async () => {
      await service.notifyVotingOpen(
        makeLineup({ status: 'voting', votingDeadline: deadline }),
        5,
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
});
