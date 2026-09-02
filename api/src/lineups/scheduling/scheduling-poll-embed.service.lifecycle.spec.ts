/**
 * ROK-1461 (slice C) — TDD pins for poll STATE and the lock-in re-render.
 *
 * CONFIRMED FAILING on the branch base:
 *   - `buildEmbedData` never selects `match.status` or `gameId`, so the embed
 *     cannot know whether the poll is open, locked in, or closed (AC3).
 *   - neither `SchedulingService.createEventFromSlot` nor
 *     `StandalonePollService.complete` asks the poll embed to re-render, so a
 *     locked-in poll keeps advertising itself as open until unrelated traffic
 *     heals it (AC3, "re-renders on lock-in").
 *
 * The DB column is `community_lineup_matches.status`
 * (suggested | scheduling | scheduled | archived); the EMBED status is the
 * three-state grammar (open | locked_in | closed). This file pins the mapping.
 */
import { Test } from '@nestjs/testing';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import { SchedulingService } from './scheduling.service';
import { StandalonePollService } from '../standalone-poll/standalone-poll.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { EventsService } from '../../events/events.service';
import { SignupsService } from '../../events/signups.service';
import { NotificationService } from '../../notifications/notification.service';
import { LineupNotificationService } from '../lineup-notification.service';

jest.mock('./scheduling-query.helpers', () => ({
  ...jest.requireActual('./scheduling-query.helpers'),
  findScheduleSlots: jest.fn().mockResolvedValue([]),
  findScheduleVotes: jest.fn().mockResolvedValue([]),
  countUniqueVoters: jest.fn().mockResolvedValue(0),
}));
jest.mock('./scheduling-event.helpers', () => ({
  ...jest.requireActual('./scheduling-event.helpers'),
  resolveGameInfo: jest
    .fn()
    .mockResolvedValue({ gameName: 'Elden Ring', gameCoverUrl: null }),
  assertUserHasVoted: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./scheduling-auto-signup.helpers', () => ({
  autoSignupSlotVoters: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./scheduling-auto-heart.helpers', () => ({
  insertPollInterests: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./scheduling-conflict.helpers', () => ({
  ...jest.requireActual('./scheduling-conflict.helpers'),
  findSlotConflicts: jest.fn().mockResolvedValue([]),
}));
jest.mock('../lineups-notify-hooks.helpers', () => ({
  fireEventCreated: jest.fn(),
}));
jest.mock('../lineups-match-query.helpers', () => ({
  ...jest.requireActual('../lineups-match-query.helpers'),
  findMatchMembers: jest.fn().mockResolvedValue([]),
}));
jest.mock('../standalone-poll/standalone-poll-auth.helpers', () => ({
  ...jest.requireActual('../standalone-poll/standalone-poll-auth.helpers'),
  assertCanCompletePoll: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../standalone-poll/standalone-poll-query.helpers', () => ({
  ...jest.requireActual('../standalone-poll/standalone-poll-query.helpers'),
  completeStandalonePoll: jest.fn().mockResolvedValue({ ok: true }),
}));

const MATCH_ID = 10;
const LINEUP_ID = 1;
const GAME_ID = 3;
const SLOT_ID = 20;
const SLOT_TIME = '2099-04-01T19:00:00.000Z';
const CLIENT_URL = 'http://localhost:5173';

/** Resolves the queued microtasks a fire-and-forget call leaves behind. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** The embed-state grammar slice C introduces (spec §Files). */
type PollStatus = 'open' | 'locked_in' | 'closed';

/** The embed service wired to mocks for every collaborator it does not own. */
function createEmbedService(
  db: MockDb,
  buildSchedulingPollEmbed: jest.Mock,
): SchedulingPollEmbedService {
  return new SchedulingPollEmbedService(
    db as never,
    { buildSchedulingPollEmbed } as never,
    {
      sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      editEmbed: jest.fn().mockResolvedValue(undefined),
    } as never,
    { resolveChannelForEvent: jest.fn().mockResolvedValue('chan-1') } as never,
    { getClientUrl: jest.fn().mockResolvedValue(CLIENT_URL) } as never,
  );
}

// ---------------------------------------------------------------------------
// buildEmbedData carries the match status + game id (AC3)
// ---------------------------------------------------------------------------

describe('SchedulingPollEmbedService.buildEmbedData — poll state (AC3)', () => {
  let mockDb: MockDb;
  let buildSchedulingPollEmbed: jest.Mock;
  let service: SchedulingPollEmbedService;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    buildSchedulingPollEmbed = jest
      .fn()
      .mockReturnValue({ embed: { toJSON: () => ({}) } });
    service = createEmbedService(mockDb, buildSchedulingPollEmbed);
  });

  /** Queue the match row, then the game row, and run one update pass. */
  async function updateWithDbStatus(
    dbStatus: string,
  ): Promise<Record<string, unknown>> {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: MATCH_ID,
        lineupId: LINEUP_ID,
        gameId: GAME_ID,
        status: dbStatus,
        embedMessageId: 'msg-1',
        embedChannelId: 'chan-1',
      },
    ]);
    mockDb.limit.mockResolvedValueOnce([
      { name: 'Elden Ring', coverUrl: null },
    ]);
    service.fireUpdateEmbed(MATCH_ID);
    await flush();
    expect(buildSchedulingPollEmbed).toHaveBeenCalled();
    return buildSchedulingPollEmbed.mock.calls[0][0] as Record<string, unknown>;
  }

  const STATUS_ROWS: [string, PollStatus][] = [
    ['scheduling', 'open'],
    ['suggested', 'open'],
    ['scheduled', 'locked_in'],
    ['archived', 'closed'],
  ];

  it.each(STATUS_ROWS)(
    'db status %s renders as %s',
    async (dbStatus, expected) => {
      const data = await updateWithDbStatus(dbStatus);
      expect(data.status).toBe(expected);
    },
  );

  it('passes the game id so the title can link /games/:id', async () => {
    const data = await updateWithDbStatus('scheduling');
    expect(data.gameId).toBe(GAME_ID);
  });
});

// ---------------------------------------------------------------------------
// Lock-in path 1: an event created from a slot (AC3)
// ---------------------------------------------------------------------------

describe('SchedulingService.createEventFromSlot — re-renders the poll (AC3)', () => {
  let service: SchedulingService;
  let mockDb: MockDb;
  let pollEmbed: {
    firePostInitialEmbed: jest.Mock;
    fireUpdateEmbed: jest.Mock;
  };

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    pollEmbed = {
      firePostInitialEmbed: jest.fn(),
      fireUpdateEmbed: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        SchedulingService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: EventsService,
          useValue: { create: jest.fn().mockResolvedValue({ id: 100 }) },
        },
        { provide: SignupsService, useValue: { signup: jest.fn() } },
        {
          provide: LineupNotificationService,
          useValue: { notifyEventCreated: jest.fn() },
        },
        { provide: SchedulingPollEmbedService, useValue: pollEmbed },
        {
          provide: NotificationService,
          useValue: { createMany: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    service = module.get(SchedulingService);

    // findMatchOrThrow, then findSlotOrThrow, then resolveGameInfo's game row.
    mockDb.limit.mockResolvedValueOnce([
      {
        id: MATCH_ID,
        lineupId: LINEUP_ID,
        gameId: GAME_ID,
        status: 'scheduling',
        linkedEventId: null,
        includeSchedulingPhase: true,
      },
    ]);
    mockDb.limit.mockResolvedValueOnce([
      { id: SLOT_ID, matchId: MATCH_ID, proposedTime: SLOT_TIME },
    ]);
    mockDb.limit.mockResolvedValueOnce([
      { name: 'Elden Ring', coverUrl: null },
    ]);
  });

  it('asks the poll embed to re-render once the event exists', async () => {
    const result = await service.createEventFromSlot(MATCH_ID, SLOT_ID, 1);
    expect(result).toMatchObject({ eventId: expect.any(Number) });
    expect(pollEmbed.fireUpdateEmbed).toHaveBeenCalledWith(MATCH_ID);
  });
});

// ---------------------------------------------------------------------------
// Lock-in path 2: POST /scheduling-polls/:id/complete (AC3)
// ---------------------------------------------------------------------------

describe('StandalonePollService.complete — re-renders the poll (AC3)', () => {
  it('asks the poll embed to re-render on lock-in', async () => {
    const pollEmbed = {
      firePostInitialEmbed: jest.fn(),
      fireUpdateEmbed: jest.fn(),
    };
    const service = new StandalonePollService(
      createDrizzleMock() as never,
      { enqueuePhaseTransition: jest.fn() } as never,
      { notifyPollCreated: jest.fn() } as never,
      pollEmbed as never,
      { signup: jest.fn() } as never,
      { getClientUrl: jest.fn().mockResolvedValue(CLIENT_URL) } as never,
      { emitLifecycleEvent: jest.fn().mockResolvedValue(undefined) } as never,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      service.complete(MATCH_ID, undefined, undefined, 1, true),
    ).resolves.toBe(true);
    await flush();
    expect(pollEmbed.fireUpdateEmbed).toHaveBeenCalledWith(MATCH_ID);
  });
});
