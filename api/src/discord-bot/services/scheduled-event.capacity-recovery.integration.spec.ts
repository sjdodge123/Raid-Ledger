/**
 * Capacity-recovery integration tests (ROK-1332).
 *
 * Covers AC6 (real DB + mocked guild.scheduledEvents): 5 stale RL-tracked
 * scheduled events get GC'd when the reconciliation cron hits a 30038
 * (MAX_SCHEDULED_EVENTS_REACHED) error; the candidate retry succeeds after
 * GC frees capacity. Also extends to AC3 (single WARN per tick) and AC4
 * (scheduled_event_reconcile_backoff_until gates the next tick).
 *
 * These tests MUST FAIL before dev implementation lands because:
 *   1. `./scheduled-event.gc` module does not yet exist.
 *   2. `scheduled_event_reconcile_backoff_until` column does not yet exist
 *      in `events` — seeding step throws "column does not exist".
 *   3. `withCapacityRecovery` is not wired into `doCreate`, so a 30038
 *      bubbles up unhandled and the retry call never fires.
 */
import { DiscordAPIError } from 'discord.js';
import { eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { ScheduledEventReconciliationService } from './scheduled-event.reconciliation';
import { makeDiscordApiError } from './scheduled-event.service.spec-helpers';
// AC6: the GC helper file does not exist yet — importing it here is what
// makes the spec compile-fail until dev step c lands. The import itself is
// the assertion that `scheduled-event.gc.ts` will exist.
import { gcStaleRLScheduledEvents } from './scheduled-event.gc';

const MAX_SCHEDULED_EVENTS_REACHED = 30038;
const FUTURE_MS = 7 * 24 * 60 * 60 * 1000;

let testApp: TestApp;
let reconciliationService: ScheduledEventReconciliationService;
let clientService: DiscordBotClientService;
let channelResolver: ChannelResolverService;

interface MockGuildShape {
  id: string;
  scheduledEvents: {
    fetch: jest.Mock<Promise<Map<string, { id: string }>>, []>;
    create: jest.Mock<Promise<{ id: string }>, [Record<string, unknown>]>;
    delete: jest.Mock<Promise<void>, [string]>;
    edit: jest.Mock<Promise<{ id: string }>, [string, Record<string, unknown>]>;
  };
  channels: { cache: { get: (_id: string) => undefined } };
}

let mockGuild: MockGuildShape;
let isConnectedSpy: jest.SpyInstance;
let getGuildSpy: jest.SpyInstance;
let resolveVoiceSpy: jest.SpyInstance;

function buildMockGuild(): MockGuildShape {
  return {
    id: 'guild-1332',
    scheduledEvents: {
      fetch: jest.fn().mockResolvedValue(new Map<string, { id: string }>()),
      create: jest.fn().mockResolvedValue({ id: 'new-se-default' }),
      delete: jest.fn().mockResolvedValue(undefined),
      edit: jest.fn().mockResolvedValue({ id: 'edited-default' }),
    },
    channels: { cache: { get: () => undefined } },
  };
}

beforeAll(async () => {
  testApp = await getTestApp();
  await loginAsAdmin(testApp.request, testApp.seed);
  reconciliationService = testApp.app.get(ScheduledEventReconciliationService);
  clientService = testApp.app.get(DiscordBotClientService);
  channelResolver = testApp.app.get(ChannelResolverService);

  // R7 (plan §7): spy in beforeAll, restore in afterAll. NEVER beforeEach/afterEach
  // — DiscordBotClientService is a singleton and per-test restore leaks across
  // sibling integration suites because the testApp persists.
  mockGuild = buildMockGuild();
  isConnectedSpy = jest
    .spyOn(clientService, 'isConnected')
    .mockReturnValue(true);
  getGuildSpy = jest
    .spyOn(clientService, 'getGuild')
    .mockReturnValue(
      mockGuild as unknown as ReturnType<DiscordBotClientService['getGuild']>,
    );
  resolveVoiceSpy = jest
    .spyOn(channelResolver, 'resolveVoiceChannelForScheduledEvent')
    .mockResolvedValue('voice-channel-1332');
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  // Reset spy call counts WITHOUT restoring (per R7) — and rebuild the mock
  // guild's scheduledEvents methods so per-test mockResolvedValueOnce setups
  // don't bleed into the next test.
  mockGuild = buildMockGuild();
  getGuildSpy.mockReturnValue(mockGuild);
  isConnectedSpy.mockReturnValue(true);
  resolveVoiceSpy.mockResolvedValue('voice-channel-1332');
});

afterAll(() => {
  isConnectedSpy?.mockRestore();
  getGuildSpy?.mockRestore();
  resolveVoiceSpy?.mockRestore();
});

interface SeededEvent {
  id: number;
  discordScheduledEventId: string | null;
}

/** Seed 5 stale RL-tracked events (cancelled_at SET, discord_scheduled_event_id SET). */
async function seedStaleRLEvents(count = 5): Promise<SeededEvent[]> {
  const now = new Date();
  const start = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3h ago
  const end = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h ago
  const rows = await testApp.db
    .insert(schema.events)
    .values(
      Array.from({ length: count }, (_, i) => ({
        title: `Stale Event ${i + 1}`,
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        duration: [start, end] as [Date, Date],
        discordScheduledEventId: `stale-se-${i + 1}`,
        cancelledAt: new Date(now.getTime() - 60 * 60 * 1000),
      })),
    )
    .returning({
      id: schema.events.id,
      discordScheduledEventId: schema.events.discordScheduledEventId,
    });
  return rows;
}

/** Seed a single fresh reconciliation candidate (no SE id, future, not ad-hoc, not cancelled). */
async function seedCandidate(): Promise<number> {
  const futureStart = new Date(Date.now() + FUTURE_MS);
  const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);
  const [row] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'New Raid Night',
      creatorId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
      duration: [futureStart, futureEnd] as [Date, Date],
      isAdHoc: false,
    })
    .returning({ id: schema.events.id });
  return row.id;
}

describe('ROK-1332 — capacity-recovery integration', () => {
  it('AC6 — reconciliation hits 30038, GC frees 5 stale RL SEs, retry succeeds', async () => {
    const stale = await seedStaleRLEvents(5);
    const candidateId = await seedCandidate();

    // Mock guild.scheduledEvents.fetch() → returns a Map of all SEs visible
    // to the bot (the 5 stale RL ones). discord.js Collection is Map-shaped,
    // so a plain Map is sufficient for `[...all.keys()]` iteration in GC.
    const seIdsOnDiscord = stale.map((s) => s.discordScheduledEventId!);
    mockGuild.scheduledEvents.fetch.mockResolvedValue(
      new Map<string, { id: string }>(seIdsOnDiscord.map((id) => [id, { id }])),
    );

    // First create() fails with 30038 (capacity full); after GC, second
    // create() resolves with a new SE id (retry succeeded).
    mockGuild.scheduledEvents.create
      .mockRejectedValueOnce(
        makeDiscordApiError(
          MAX_SCHEDULED_EVENTS_REACHED,
          'Maximum number of guild scheduled events reached (100)',
        ),
      )
      .mockResolvedValueOnce({ id: 'new-se-after-gc' });

    await reconciliationService.reconcileMissingScheduledEvents();

    // GC deleted all 5 stale SEs via tryDeleteEvent → guild.scheduledEvents.delete
    expect(mockGuild.scheduledEvents.delete).toHaveBeenCalledTimes(5);
    for (const seId of seIdsOnDiscord) {
      expect(mockGuild.scheduledEvents.delete).toHaveBeenCalledWith(seId);
    }

    // 5 stale rows had their discord_scheduled_event_id cleared by GC.
    const staleIds = stale.map((s) => s.id);
    const reloadedStale = await testApp.db
      .select({
        id: schema.events.id,
        discordScheduledEventId: schema.events.discordScheduledEventId,
      })
      .from(schema.events)
      .where(inArray(schema.events.id, staleIds));
    for (const row of reloadedStale) {
      expect(row.discordScheduledEventId).toBeNull();
    }

    // The candidate retry attempt produced a new SE id and persisted it.
    expect(mockGuild.scheduledEvents.create).toHaveBeenCalledTimes(2);
    const [candidateRow] = await testApp.db
      .select({
        discordScheduledEventId: schema.events.discordScheduledEventId,
      })
      .from(schema.events)
      .where(eq(schema.events.id, candidateId))
      .limit(1);
    expect(candidateRow.discordScheduledEventId).toBe('new-se-after-gc');
  });

  it('AC3 + AC5 — when GC frees 0, single WARN logs and remaining candidates get 1h backoff', async () => {
    // No RL-tracked stale SEs — only operator-owned orphans (5 SEs visible to bot,
    // none of which are in events.discord_scheduled_event_id).
    mockGuild.scheduledEvents.fetch.mockResolvedValue(
      new Map<string, { id: string }>(
        Array.from({ length: 5 }, (_, i) => [
          `operator-orphan-${i}`,
          { id: `operator-orphan-${i}` },
        ]),
      ),
    );

    // Seed two candidates — the cron picks them both up. First create() throws
    // 30038; GC sweeps but finds 0 RL-tracked stale; second candidate must
    // NOT receive a create attempt because the cron stops iterating.
    const c1 = await seedCandidate();
    const c2 = await seedCandidate();

    mockGuild.scheduledEvents.create.mockRejectedValue(
      makeDiscordApiError(
        MAX_SCHEDULED_EVENTS_REACHED,
        'Maximum number of guild scheduled events reached (100)',
      ),
    );

    // Spy on the reconciliation service logger to count WARNs.
    const logger = (
      reconciliationService as unknown as {
        logger: { warn: jest.Mock; log: jest.Mock; error: jest.Mock };
      }
    ).logger;
    const warnSpy = jest.spyOn(logger, 'warn');

    try {
      await reconciliationService.reconcileMissingScheduledEvents();

      // Single WARN per cron tick (AC5).
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Only ONE create attempt happened — the cron stopped after the first
      // CapacityStillSaturatedError instead of iterating to c2 (AC3 "exactly
      // ONE WARN per tick" requires NOT looping into per-candidate errors).
      expect(mockGuild.scheduledEvents.create).toHaveBeenCalledTimes(1);

      // Both candidates now have backoff_until set ≈1h in the future (AC4).
      const rows = await testApp.db
        .select({
          id: schema.events.id,
          backoffUntil: schema.events.scheduledEventReconcileBackoffUntil,
        })
        .from(schema.events)
        .where(inArray(schema.events.id, [c1, c2]));

      expect(rows).toHaveLength(2);
      const oneHourMs = 60 * 60 * 1000;
      const now = Date.now();
      for (const row of rows) {
        expect(row.backoffUntil).not.toBeNull();
        const diff = row.backoffUntil!.getTime() - now;
        // ±5min tolerance for clock skew + cron wall-time vs assertion wall-time.
        expect(diff).toBeGreaterThan(oneHourMs - 5 * 60 * 1000);
        expect(diff).toBeLessThan(oneHourMs + 5 * 60 * 1000);
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('AC4 — candidate with future backoff_until is excluded from reconciliation', async () => {
    // Seed a candidate with backoff_until 30min in the future.
    const futureStart = new Date(Date.now() + FUTURE_MS);
    const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);
    await testApp.db.insert(schema.events).values({
      title: 'Backed-off Candidate',
      creatorId: testApp.seed.adminUser.id,
      gameId: testApp.seed.game.id,
      duration: [futureStart, futureEnd] as [Date, Date],
      isAdHoc: false,
      scheduledEventReconcileBackoffUntil: new Date(
        Date.now() + 30 * 60 * 1000,
      ),
    });

    await reconciliationService.reconcileMissingScheduledEvents();

    // findReconciliationCandidates must have excluded the backed-off row,
    // so no create() attempt was made.
    expect(mockGuild.scheduledEvents.create).not.toHaveBeenCalled();
  });

  it('AC2 — gcStaleRLScheduledEvents helper directly: cancelled→delete, orphan→count, active+future→skip', async () => {
    // Seed: 2 stale RL (cancelled), 1 active+future RL (NOT stale), 0 operator orphans.
    const now = new Date();
    const staleStart = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const staleEnd = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const futureStart = new Date(now.getTime() + FUTURE_MS);
    const futureEnd = new Date(futureStart.getTime() + 3 * 60 * 60 * 1000);

    await testApp.db.insert(schema.events).values([
      {
        title: 'Cancelled-1',
        creatorId: testApp.seed.adminUser.id,
        duration: [staleStart, staleEnd] as [Date, Date],
        discordScheduledEventId: 'stale-cx-1',
        cancelledAt: new Date(now.getTime() - 60 * 60 * 1000),
      },
      {
        title: 'Cancelled-2',
        creatorId: testApp.seed.adminUser.id,
        duration: [staleStart, staleEnd] as [Date, Date],
        discordScheduledEventId: 'stale-cx-2',
        cancelledAt: new Date(now.getTime() - 60 * 60 * 1000),
      },
      {
        title: 'Active-Future',
        creatorId: testApp.seed.adminUser.id,
        duration: [futureStart, futureEnd] as [Date, Date],
        discordScheduledEventId: 'active-keep-1',
      },
    ]);

    // The guild sees 4 SEs: 2 stale RL, 1 active RL, 1 operator-owned orphan.
    mockGuild.scheduledEvents.fetch.mockResolvedValue(
      new Map<string, { id: string }>([
        ['stale-cx-1', { id: 'stale-cx-1' }],
        ['stale-cx-2', { id: 'stale-cx-2' }],
        ['active-keep-1', { id: 'active-keep-1' }],
        ['operator-orphan-1', { id: 'operator-orphan-1' }],
      ]),
    );

    const { freed, orphanCount } = await gcStaleRLScheduledEvents(
      mockGuild as unknown as Parameters<typeof gcStaleRLScheduledEvents>[0],
      testApp.db,
    );

    expect(freed).toBe(2);
    expect(orphanCount).toBe(1);
    // Only the 2 stale SEs got deleted from Discord.
    expect(mockGuild.scheduledEvents.delete).toHaveBeenCalledTimes(2);
    expect(mockGuild.scheduledEvents.delete).toHaveBeenCalledWith('stale-cx-1');
    expect(mockGuild.scheduledEvents.delete).toHaveBeenCalledWith('stale-cx-2');
    expect(mockGuild.scheduledEvents.delete).not.toHaveBeenCalledWith(
      'active-keep-1',
    );
    expect(mockGuild.scheduledEvents.delete).not.toHaveBeenCalledWith(
      'operator-orphan-1',
    );
  });

  it('ROK-1332 review fix — extended-but-live event (past duration, future extendedUntil) is NOT GC-deleted', async () => {
    // Regression guard: GC staleness uses COALESCE(extended_until, upper(duration)).
    // An auto-extended event (members still in voice past the original end) has
    // upper(duration) in the past but extended_until in the future → still live,
    // so its Discord SE must be preserved.
    const now = new Date();
    const pastStart = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const pastEnd = new Date(now.getTime() - 3 * 60 * 60 * 1000); // ended 3h ago
    const futureExtension = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2h

    await testApp.db.insert(schema.events).values({
      title: 'Extended-Live',
      creatorId: testApp.seed.adminUser.id,
      duration: [pastStart, pastEnd] as [Date, Date],
      extendedUntil: futureExtension,
      discordScheduledEventId: 'extended-live-1',
    });

    mockGuild.scheduledEvents.fetch.mockResolvedValue(
      new Map<string, { id: string }>([
        ['extended-live-1', { id: 'extended-live-1' }],
      ]),
    );

    const { freed, orphanCount } = await gcStaleRLScheduledEvents(
      mockGuild as unknown as Parameters<typeof gcStaleRLScheduledEvents>[0],
      testApp.db,
    );

    expect(freed).toBe(0);
    expect(orphanCount).toBe(0);
    expect(mockGuild.scheduledEvents.delete).not.toHaveBeenCalled();
  });

  it('helper integration — uses DiscordAPIError instanceof for 30038 classification', () => {
    // Sanity: makeDiscordApiError must produce a true DiscordAPIError so the
    // dev's `isAtScheduledEventCapacityError` (instanceof DiscordAPIError &&
    // code === 30038) matches. This guards R2 (mock leak / wrong class).
    const err = makeDiscordApiError(
      MAX_SCHEDULED_EVENTS_REACHED,
      'capacity full',
    );
    expect(err).toBeInstanceOf(DiscordAPIError);
    expect(err.code).toBe(MAX_SCHEDULED_EVENTS_REACHED);
  });
});
