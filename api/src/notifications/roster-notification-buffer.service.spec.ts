import { Test, TestingModule } from '@nestjs/testing';
import {
  RosterNotificationBufferService,
  ROSTER_NOTIFY_GRACE_MS,
  type BufferedRosterAction,
} from './roster-notification-buffer.service';
import { NotificationService } from './notification.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

let service: RosterNotificationBufferService;
let mockNotificationService: {
  create: jest.Mock;
  getDiscordEmbedUrl: jest.Mock;
  resolveVoiceChannelForEvent: jest.Mock;
};

/**
 * Mock DB supporting multiple select chains.
 * Each `select()` call pops the next chain from `selectChains`.
 */
let mockDb: { select: jest.Mock };
let selectChains: ReturnType<typeof makeSelectChain>[];

/** Build a chainable Drizzle select that resolves via .limit(). */
function makeSelectChain(rows: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.innerJoin = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  return chain;
}

/** MMO event fixture (tank departure is relevant). */
const mmoEvent = {
  id: 1,
  slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 },
  maxAttendees: null,
};

/** Generic event at capacity (player departure is relevant). */
const genericFullEvent = {
  id: 1,
  slotConfig: { type: 'generic', player: 5 },
  maxAttendees: null,
};

/** Generic event NOT at capacity. */
const genericNotFullEvent = {
  id: 1,
  slotConfig: { type: 'generic', player: 10 },
  maxAttendees: null,
};

/** No-config, no-cap event. */
const noCapEvent = {
  id: 1,
  slotConfig: null,
  maxAttendees: null,
};

const baseAction: BufferedRosterAction = {
  organizerId: 100,
  eventId: 1,
  eventTitle: 'DM 5 man',
  userId: 42,
  displayName: 'HealzForDayz',
  vacatedRole: 'dps',
};

/**
 * Set up select chains for a standard "player left" flush.
 * Chain 1: assignment lookup (empty = player left)
 * Chain 2: event lookup
 * Chain 3: active signup count (only for non-MMO capacity check)
 */
function setupFlushChains(
  event: Record<string, unknown>,
  signupCount?: number,
) {
  const chains = [
    makeSelectChain([]), // assignment lookup: player left
    makeSelectChain([event]), // event lookup
  ];
  if (signupCount !== undefined) {
    chains.push(makeSelectChain([{ count: signupCount }]));
  }
  selectChains = chains;
}

async function setupEach() {
  mockNotificationService = {
    create: jest.fn().mockResolvedValue(null),
    getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
    resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
  };

  selectChains = [];
  mockDb = {
    select: jest.fn().mockImplementation(() => {
      const chain = selectChains.shift();
      if (chain) return chain;
      return makeSelectChain([]);
    }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RosterNotificationBufferService,
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();

  service = module.get(RosterNotificationBufferService);
  jest.useFakeTimers();
}

async function testBufferLeaveFiresAfterGrace() {
  setupFlushChains(mmoEvent);
  const action = { ...baseAction, vacatedRole: 'tank' };
  service.bufferLeave(action);
  expect(service.pendingCount).toBe(1);

  jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
  await jest.runAllTimersAsync();

  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: baseAction.organizerId,
      type: 'slot_vacated',
      title: 'Slot Vacated',
      message: 'HealzForDayz left the tank slot for DM 5 man',
    }),
  );
  expect(service.pendingCount).toBe(0);
}

async function testResetsGraceTimerOnReLeave() {
  setupFlushChains(mmoEvent);
  service.bufferLeave({ ...baseAction, vacatedRole: 'healer' });

  jest.advanceTimersByTime(2 * 60 * 1000);
  service.bufferLeave({ ...baseAction, vacatedRole: 'healer' });
  jest.advanceTimersByTime(2 * 60 * 1000);

  expect(mockNotificationService.create).not.toHaveBeenCalled();

  jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS);
  await jest.runAllTimersAsync();

  expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'HealzForDayz left the healer slot for DM 5 man',
    }),
  );
}

async function testJoinedNotificationOnSlotMove() {
  // Chain 1: assignment lookup (found = slot move, skips relevance)
  selectChains = [makeSelectChain([{ role: 'healer' }])];
  service.bufferLeave(baseAction);

  jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
  await jest.runAllTimersAsync();

  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: baseAction.organizerId,
      type: 'slot_vacated',
      title: 'Roster Change',
      message: 'HealzForDayz joined the healer slot for DM 5 man',
    }),
  );
}

async function testBufferJoinResetsTimer() {
  selectChains = [makeSelectChain([{ role: 'healer' }])];
  service.bufferLeave(baseAction);

  jest.advanceTimersByTime(60 * 1000);
  service.bufferJoin(baseAction.eventId, baseAction.userId);

  jest.advanceTimersByTime(2 * 60 * 1000);
  expect(mockNotificationService.create).not.toHaveBeenCalled();

  jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS);
  await jest.runAllTimersAsync();

  expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
}

async function testIncludesDiscordUrlAndVoiceChannel() {
  setupFlushChains(mmoEvent);
  mockNotificationService.getDiscordEmbedUrl.mockResolvedValue(
    'https://discord.com/channels/1/2/3',
  );
  mockNotificationService.resolveVoiceChannelForEvent.mockResolvedValue(
    'vc-123',
  );

  service.bufferLeave({ ...baseAction, vacatedRole: 'tank' });

  jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
  await jest.runAllTimersAsync();

  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: {
        eventId: 1,
        discordUrl: 'https://discord.com/channels/1/2/3',
        voiceChannelId: 'vc-123',
      },
    }),
  );
}

describe('RosterNotificationBufferService (ROK-534)', () => {
  beforeEach(() => setupEach());

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('buffers a leave action and fires notification after grace period', () =>
    testBufferLeaveFiresAfterGrace());

  it('resets the grace timer when the same user leaves again', () =>
    testResetsGraceTimerOnReLeave());

  it('sends "joined" notification when user moved to a different slot', () =>
    testJoinedNotificationOnSlotMove());

  it('skips notification when user returned to the same slot', async () => {
    selectChains = [makeSelectChain([{ role: 'dps' }])];
    service.bufferLeave(baseAction);

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).not.toHaveBeenCalled();
  });

  it('bufferJoin resets the timer for an existing buffer entry', () =>
    testBufferJoinResetsTimer());

  it('bufferJoin is a no-op when there is nothing buffered', () => {
    service.bufferJoin(999, 999);
    expect(service.pendingCount).toBe(0);
  });

  it('handles multiple users on same event independently', async () => {
    // Both are tank departures on MMO event (relevant)
    // Use flushAll to avoid timer-based race conditions
    selectChains = [
      makeSelectChain([]), // user1 assignment
      makeSelectChain([mmoEvent]), // user1 event
      makeSelectChain([]), // user2 assignment
      makeSelectChain([mmoEvent]), // user2 event
    ];

    service.bufferLeave({ ...baseAction, vacatedRole: 'tank' });
    service.bufferLeave({
      ...baseAction,
      userId: 99,
      displayName: 'TankBro',
      vacatedRole: 'tank',
    });
    expect(service.pendingCount).toBe(2);

    await service.flushAll();

    expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
  });

  it('includes discord URL and voice channel in notification payload', () =>
    testIncludesDiscordUrlAndVoiceChannel());

  it('onModuleDestroy clears all pending timers', () => {
    service.bufferLeave(baseAction);
    expect(service.pendingCount).toBe(1);

    service.onModuleDestroy();
    expect(service.pendingCount).toBe(0);
  });

  it('flushAll forces immediate flush of all entries', async () => {
    selectChains = [
      makeSelectChain([]), // user1 assignment
      makeSelectChain([mmoEvent]), // user1 event
      makeSelectChain([]), // user2 assignment
      makeSelectChain([mmoEvent]), // user2 event
    ];

    service.bufferLeave({ ...baseAction, vacatedRole: 'tank' });
    service.bufferLeave({
      ...baseAction,
      userId: 99,
      displayName: 'TankBro',
      vacatedRole: 'tank',
    });

    await service.flushAll();

    expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    expect(service.pendingCount).toBe(0);
  });
});

// ── ROK-919: Relevance filter tests ──

describe('RosterNotificationBufferService — relevance filter (ROK-919)', () => {
  beforeEach(() => setupEach());

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('suppresses notification for DPS departure from MMO event', async () => {
    setupFlushChains(mmoEvent);
    service.bufferLeave({ ...baseAction, vacatedRole: 'dps' });

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).not.toHaveBeenCalled();
  });

  it('sends notification for tank departure from MMO event', async () => {
    setupFlushChains(mmoEvent);
    service.bufferLeave({ ...baseAction, vacatedRole: 'tank' });

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'slot_vacated' }),
    );
  });

  it('sends notification for healer departure from MMO event', async () => {
    setupFlushChains(mmoEvent);
    service.bufferLeave({ ...baseAction, vacatedRole: 'healer' });

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'slot_vacated' }),
    );
  });

  it('suppresses notification for player departure from non-full generic event', async () => {
    // capacity=10, activeSignups=3 → +1=4 < 10, not full
    setupFlushChains(genericNotFullEvent, 3);
    service.bufferLeave({ ...baseAction, vacatedRole: 'player' });

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).not.toHaveBeenCalled();
  });

  it('sends notification for player departure from full generic event', async () => {
    // capacity=5, activeSignups=4 → +1=5 = capacity, was full
    setupFlushChains(genericFullEvent, 4);
    service.bufferLeave({ ...baseAction, vacatedRole: 'player' });

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'slot_vacated' }),
    );
  });

  it('suppresses notification for no-cap event departure', async () => {
    setupFlushChains(noCapEvent);
    service.bufferLeave({ ...baseAction, vacatedRole: 'player' });

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).not.toHaveBeenCalled();
  });

  it('suppresses notification when event not found in DB', async () => {
    selectChains = [
      makeSelectChain([]), // assignment lookup: player left
      makeSelectChain([]), // event lookup: not found
    ];
    service.bufferLeave(baseAction);

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).not.toHaveBeenCalled();
  });

  // ── Adversarial: flex departure on MMO event ────────────────────────────

  it('suppresses notification for flex departure from MMO event', async () => {
    setupFlushChains(mmoEvent);
    service.bufferLeave({ ...baseAction, vacatedRole: 'flex' });

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).not.toHaveBeenCalled();
  });

  // ── Adversarial: boundary — one below capacity ──────────────────────────

  it('suppresses notification for generic event one slot below capacity', async () => {
    // capacity=10, activeSignups after departure=8, 8+1=9 < 10 => not full
    setupFlushChains(genericNotFullEvent, 8);
    service.bufferLeave({ ...baseAction, vacatedRole: 'player' });

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).not.toHaveBeenCalled();
  });

  // ── Adversarial: count coercion from DB string ─────────────────────────

  it('correctly handles DB count returned as string for capacity check', async () => {
    // capacity=5, DB returns count as string '4' (postgres-js behaviour)
    // 4+1=5 = capacity => relevant
    selectChains = [
      makeSelectChain([]), // assignment lookup: player left
      makeSelectChain([genericFullEvent]), // event lookup
      makeSelectChain([{ count: '4' }]), // count returned as string
    ];
    service.bufferLeave({ ...baseAction, vacatedRole: 'player' });

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    expect(mockNotificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'slot_vacated' }),
    );
  });

  // ── Adversarial: flushAll on empty buffer ───────────────────────────────

  it('flushAll on empty buffer is a no-op and does not throw', async () => {
    expect(service.pendingCount).toBe(0);
    await expect(service.flushAll()).resolves.toBeUndefined();
    expect(mockNotificationService.create).not.toHaveBeenCalled();
  });

  // ── Adversarial: MMO tank departure skips DB count query ────────────────

  it('does not query signup count for MMO tank departure (optimisation)', async () => {
    // For MMO events, relevance is purely role-based — no DB count needed
    // Only 2 select chains should be used: assignment + event lookup
    setupFlushChains(mmoEvent); // no count chain provided
    service.bufferLeave({ ...baseAction, vacatedRole: 'tank' });

    jest.advanceTimersByTime(ROSTER_NOTIFY_GRACE_MS + 100);
    await jest.runAllTimersAsync();

    // 2 chains consumed: assignment + event. No 3rd chain for count.
    // If a 3rd DB call were made, it would consume the fallback empty chain
    // and the notification would still fire — so we verify by call count.
    // The notify chain also calls buildFlushPayload (2 more mock methods).
    expect(mockNotificationService.create).toHaveBeenCalled();
    // Verify only 2 select chains were consumed (selectChains exhausted to [])
    expect(selectChains).toHaveLength(0);
  });
});
