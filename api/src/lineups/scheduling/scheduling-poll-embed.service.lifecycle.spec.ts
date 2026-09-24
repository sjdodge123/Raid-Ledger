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
import { SchedulingUnanimousService } from './scheduling-unanimous.service';
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
  // ROK-1610: the lock-in path hearts the slot's voters; unmocked it is a
  // real DB write inside a unit spec.
  fireAutoHeartForVoters: jest.fn(),
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
/**
 * The lineup meta row `assertMayLockInSlot` → `findLineupPollMeta` reads
 * (ROK-1610). Not archived and no phase deadline ⇒ the poll is still OPEN, so
 * lock-in takes the unchanged "must have voted" branch (that helper is mocked).
 */
const LINEUP_POLL_META_ROW = {
  id: LINEUP_ID,
  status: 'decided',
  visibility: 'public',
  createdBy: 1,
  phaseDeadline: null,
  includeSchedulingPhase: true,
  phaseDurationOverride: null,
};
const CLIENT_URL = 'http://localhost:5173';
const COMMUNITY = 'Raid-Ledger dev';
const TIMEZONE = 'America/New_York';

/** Resolves the queued microtasks a fire-and-forget call leaves behind. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** The embed-state grammar slice C introduces (spec §Files). */
type PollStatus = 'open' | 'locked_in' | 'cancelled' | 'closed';

/** ROK-1549/1551 collaborators the sync path adds. */
interface SyncMocks {
  enqueue: jest.Mock;
  emitScheduleChanged: jest.Mock;
  editEmbed: jest.Mock;
}

/** The embed service wired to mocks for every collaborator it does not own. */
function createEmbedService(
  db: MockDb,
  buildSchedulingPollEmbed: jest.Mock,
  sync: SyncMocks = newSyncMocks(),
): SchedulingPollEmbedService {
  return new SchedulingPollEmbedService(
    db as never,
    { buildSchedulingPollEmbed } as never,
    {
      sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      editEmbed: sync.editEmbed,
    } as never,
    { resolveChannelForEvent: jest.fn().mockResolvedValue('chan-1') } as never,
    {
      getClientUrl: jest.fn().mockResolvedValue(CLIENT_URL),
      // ROK-1461 (operator walk): the poll reads the SAME branding source as
      // the lineup card, so the two footers cannot say different names.
      getBranding: jest.fn().mockResolvedValue({ communityName: COMMUNITY }),
      getDefaultTimezone: jest.fn().mockResolvedValue(TIMEZONE),
    } as never,
    // ROK-1473: warn-once dedup for a broken per-lineup channel override.
    { checkAndMarkSent: jest.fn().mockResolvedValue(false) } as never,
    { enqueue: sync.enqueue } as never,
    { emitScheduleChanged: sync.emitScheduleChanged } as never,
  );
}

/** Fresh ROK-1549/1551 collaborator mocks. */
function newSyncMocks(): SyncMocks {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    emitScheduleChanged: jest.fn(),
    editEmbed: jest.fn().mockResolvedValue(undefined),
  };
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
    // ROK-1545 (review F2): `updateEmbed` now also reads the parent lineup's
    // status + deadline so the embed can reach `closed` on an EXPIRED poll.
    mockDb.limit.mockResolvedValueOnce([
      { status: 'decided', phaseDeadline: null },
    ]);
    mockDb.limit.mockResolvedValueOnce([
      { name: 'Elden Ring', coverUrl: null },
    ]);
    await service.syncEmbed(MATCH_ID);
    expect(buildSchedulingPollEmbed).toHaveBeenCalled();
    return buildSchedulingPollEmbed.mock.calls[0][0] as Record<string, unknown>;
  }

  const STATUS_ROWS: [string, PollStatus][] = [
    ['scheduling', 'open'],
    ['suggested', 'open'],
    ['scheduled', 'locked_in'],
    // ROK-1545 split the single "closed" ending in two: an operator-archived
    // match is CANCELLED; `closed` now means the deadline ran out.
    ['archived', 'cancelled'],
  ];

  it.each(STATUS_ROWS)(
    'db status %s renders as %s',
    async (dbStatus, expected) => {
      const data = await updateWithDbStatus(dbStatus);
      expect(data.status).toBe(expected);
    },
  );

  // ROK-1461 review follow-up (Codex P2): lock-in may select a slot that is
  // not the top-voted one, so the embed must be handed the linked event's
  // start time rather than re-deriving a winner from the vote counts.
  it('carries the linked event start time on a locked-in poll', async () => {
    const startTime = '2099-04-02T20:00:00.000Z';
    mockDb.limit.mockResolvedValueOnce([
      {
        id: MATCH_ID,
        lineupId: LINEUP_ID,
        gameId: GAME_ID,
        status: 'scheduled',
        linkedEventId: 100,
        embedMessageId: 'msg-1',
        embedChannelId: 'chan-1',
      },
    ]);
    // ROK-1545 (review F2): `updateEmbed` now also reads the parent lineup's
    // status + deadline so the embed can reach `closed` on an EXPIRED poll.
    mockDb.limit.mockResolvedValueOnce([
      { status: 'decided', phaseDeadline: null },
    ]);
    mockDb.limit.mockResolvedValueOnce([{ startTime }]);
    mockDb.limit.mockResolvedValueOnce([
      { name: 'Elden Ring', coverUrl: null },
    ]);

    await service.syncEmbed(MATCH_ID);

    const data = buildSchedulingPollEmbed.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(data.status).toBe('locked_in');
    expect(data.lockedInTime).toBe(new Date(startTime).toISOString());
  });

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
        // ROK-1632 AC3: the post-commit "everyone's in" hook.
        {
          provide: SchedulingUnanimousService,
          useValue: { checkMatch: jest.fn().mockResolvedValue(0) },
        },
      ],
    }).compile();
    service = module.get(SchedulingService);

    // findMatchOrThrow, findSlotOrThrow, the lock-in gate's lineup meta read
    // (ROK-1610), then resolveGameInfo's game row.
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
    mockDb.limit.mockResolvedValueOnce([LINEUP_POLL_META_ROW]);
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

/**
 * ROK-1461 operator walk (2026-09-02): the poll footer read
 * `Raid Ledger · Scheduling Poll` while the lineup card beside it read the
 * configured community name — the poll passed `clientUrl` alone, so the chrome
 * fell back to `DEFAULT_COMMUNITY_NAME`.
 */
describe('SchedulingPollEmbedService — embed context comes from settings', () => {
  it('passes the configured community name, client URL and timezone', async () => {
    const mockDb = createDrizzleMock();
    const buildSchedulingPollEmbed = jest
      .fn()
      .mockReturnValue({ embed: { toJSON: () => ({}) } });
    const service = createEmbedService(mockDb, buildSchedulingPollEmbed);
    mockDb.limit.mockResolvedValueOnce([
      {
        id: MATCH_ID,
        lineupId: LINEUP_ID,
        gameId: GAME_ID,
        status: 'scheduling',
        linkedEventId: null,
        embedMessageId: 'msg-1',
        embedChannelId: 'chan-1',
      },
    ]);
    // ROK-1545 (review F2): the parent lineup's lifecycle row.
    mockDb.limit.mockResolvedValueOnce([
      { status: 'decided', phaseDeadline: null },
    ]);
    mockDb.limit.mockResolvedValueOnce([
      { name: 'Elden Ring', coverUrl: null },
    ]);

    await service.syncEmbed(MATCH_ID);

    expect(buildSchedulingPollEmbed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        communityName: COMMUNITY,
        clientUrl: CLIENT_URL,
        timezone: TIMEZONE,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// ROK-1549 S1-AC1/AC3 + ROK-1551 emit
// ---------------------------------------------------------------------------

describe('SchedulingPollEmbedService — debounced sync (ROK-1549/1551)', () => {
  let mockDb: MockDb;
  let buildSchedulingPollEmbed: jest.Mock;
  let sync: SyncMocks;
  let service: SchedulingPollEmbedService;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    buildSchedulingPollEmbed = jest
      .fn()
      .mockReturnValue({ embed: { toJSON: () => ({}) } });
    sync = newSyncMocks();
    service = createEmbedService(mockDb, buildSchedulingPollEmbed, sync);
  });

  /** Queue the match, lineup and game rows for one sync pass. */
  function queueRows(
    match: Record<string, unknown>,
    lineup: Record<string, unknown>,
  ): void {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: MATCH_ID,
        lineupId: LINEUP_ID,
        gameId: GAME_ID,
        linkedEventId: null,
        embedMessageId: 'msg-1',
        embedChannelId: 'chan-1',
        ...match,
      },
    ]);
    mockDb.limit.mockResolvedValueOnce([lineup]);
    mockDb.limit.mockResolvedValueOnce([
      { name: 'Elden Ring', coverUrl: null },
    ]);
  }

  it('fireUpdateEmbed enqueues and never edits Discord inline', async () => {
    service.fireUpdateEmbed(MATCH_ID);
    await flush();
    expect(sync.enqueue).toHaveBeenCalledWith(MATCH_ID);
    expect(sync.editEmbed).not.toHaveBeenCalled();
    expect(buildSchedulingPollEmbed).not.toHaveBeenCalled();
    // ROK-1683: the ONLY inline read is the lineupId projection the immediate
    // page nudge needs — no render-data loads before the queued job.
    expect(mockDb.select).toHaveBeenCalledTimes(1);
    expect(mockDb.select).toHaveBeenCalledWith({
      lineupId: expect.anything(),
    });
  });

  it('emits schedule-changed even when the poll has no Discord card', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { id: MATCH_ID, lineupId: LINEUP_ID, embedMessageId: null },
    ]);
    await service.syncEmbed(MATCH_ID);
    expect(sync.emitScheduleChanged).toHaveBeenCalledWith(LINEUP_ID, MATCH_ID);
    expect(sync.editEmbed).not.toHaveBeenCalled();
  });

  it('passes the persisted cancellation reason on a cancelled poll', async () => {
    queueRows(
      { status: 'archived', cancellationReason: 'Raid night moved' },
      { status: 'decided', phaseDeadline: null },
    );
    await service.syncEmbed(MATCH_ID);
    const data = buildSchedulingPollEmbed.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(data.status).toBe('cancelled');
    expect(data.cancelReason).toBe('Raid night moved');
  });

  it('passes the lineup deadline as ISO on an open poll', async () => {
    const deadline = new Date('2099-04-03T12:00:00.000Z');
    queueRows(
      { status: 'scheduling' },
      { status: 'decided', phaseDeadline: deadline },
    );
    await service.syncEmbed(MATCH_ID);
    const data = buildSchedulingPollEmbed.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(data.deadline).toBe(deadline.toISOString());
    expect(data.cancelReason).toBeNull();
  });

  it('rethrows an editEmbed failure so the queue retries', async () => {
    queueRows(
      { status: 'scheduling' },
      { status: 'decided', phaseDeadline: null },
    );
    sync.editEmbed.mockRejectedValueOnce(new Error('discord 500'));
    await expect(service.syncEmbed(MATCH_ID)).rejects.toThrow('discord 500');
  });
});
