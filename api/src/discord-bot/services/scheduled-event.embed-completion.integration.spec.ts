/**
 * ROK-1818: an ended event with NO Discord scheduled event must still get the
 * `cron-complete` embed sync from the completion cron — that sync is what moves
 * its channel embed to COMPLETED and deletes the "Spots still available" bump.
 *
 * Runs the real cron entry point (`completeExpiredEventsDetailed`) against a
 * real DB. Only the embed-sync enqueue and the Discord client are stubbed.
 */
import { eq } from 'drizzle-orm';
import { GuildScheduledEventStatus } from 'discord.js';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { ScheduledEventService } from './scheduled-event.service';
import { findEmbedOnlyCompletionCandidates } from './scheduled-event.embed-completion';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let app: TestApp;
let service: ScheduledEventService;
let enqueueSpy: jest.SpyInstance;
let isConnectedSpy: jest.SpyInstance;
let getGuildSpy: jest.SpyInstance;

const mockGuild = {
  id: 'guild-1818',
  scheduledEvents: { fetch: jest.fn() },
};

beforeAll(async () => {
  app = await getTestApp();
  service = app.app.get(ScheduledEventService);
  const client = app.app.get(DiscordBotClientService);
  // Spy in beforeAll, restore in afterAll: the services are singletons shared
  // with sibling suites through the persisted test app.
  enqueueSpy = jest
    .spyOn(app.app.get(EmbedSyncQueueService), 'enqueue')
    .mockResolvedValue(undefined);
  isConnectedSpy = jest.spyOn(client, 'isConnected').mockReturnValue(false);
  getGuildSpy = jest.spyOn(client, 'getGuild').mockReturnValue(null);
});

afterEach(async () => {
  app.seed = await truncateAllTables(app.db);
  enqueueSpy.mockClear();
  isConnectedSpy.mockReturnValue(false);
  getGuildSpy.mockReturnValue(null);
  mockGuild.scheduledEvents.fetch.mockReset();
});

afterAll(() => {
  enqueueSpy?.mockRestore();
  isConnectedSpy?.mockRestore();
  getGuildSpy?.mockRestore();
});

interface EventOpts {
  endedAgoMs: number;
  seId?: string | null;
  embedState?: string | null;
  isAdHoc?: boolean;
  cancelled?: boolean;
  extendedUntil?: Date;
}

/** Insert an event that ended `endedAgoMs` ago (negative = still running). */
async function seedEvent(opts: EventOpts): Promise<number> {
  const end = new Date(Date.now() - opts.endedAgoMs);
  const [row] = await app.db
    .insert(schema.events)
    .values({
      title: 'ROK-1818 probe',
      creatorId: app.seed.adminUser.id,
      gameId: app.seed.game.id,
      duration: [new Date(end.getTime() - 2 * HOUR_MS), end] as [Date, Date],
      discordScheduledEventId: opts.seId ?? null,
      isAdHoc: opts.isAdHoc ?? false,
      ...(opts.cancelled ? { cancelledAt: new Date() } : {}),
      ...(opts.extendedUntil ? { extendedUntil: opts.extendedUntil } : {}),
    })
    .returning({ id: schema.events.id });
  if (!row) throw new Error('event insert returned no row');
  if (opts.embedState !== null) {
    await app.db.insert(schema.discordEventMessages).values({
      eventId: row.id,
      guildId: mockGuild.id,
      channelId: 'channel-1818',
      messageId: `message-${row.id}`,
      embedState: opts.embedState ?? 'live',
    });
  }
  return row.id;
}

function enqueuedIds(): unknown[] {
  return enqueueSpy.mock.calls.map((call: unknown[]) => call[0]);
}

describe('completion cron — events without a Discord scheduled event (ROK-1818)', () => {
  it('enqueues cron-complete for an ended event with no SE, even with the bot disconnected', async () => {
    const id = await seedEvent({ endedAgoMs: HOUR_MS });

    const run = await service.completeExpiredEventsDetailed();

    expect(run.reason).toBe('bot-not-connected');
    expect(enqueueSpy).toHaveBeenCalledWith(id, 'cron-complete');
    expect(run.embedOnlyEventIds).toEqual([id]);
  });

  it('does not re-enqueue an event whose embed is already COMPLETED or CANCELLED', async () => {
    await seedEvent({ endedAgoMs: HOUR_MS, embedState: 'completed' });
    await seedEvent({ endedAgoMs: HOUR_MS, embedState: 'cancelled' });

    const run = await service.completeExpiredEventsDetailed();

    expect(enqueuedIds()).toEqual([]);
    expect(run.embedOnlyEventIds).toBeUndefined();
  });

  it('enqueues an event WITH an SE exactly once (the SE pass, not the sweep)', async () => {
    isConnectedSpy.mockReturnValue(true);
    getGuildSpy.mockReturnValue(mockGuild);
    mockGuild.scheduledEvents.fetch.mockResolvedValue({
      id: 'se-1818',
      status: GuildScheduledEventStatus.Completed,
    });
    const id = await seedEvent({ endedAgoMs: HOUR_MS, seId: 'se-1818' });

    const run = await service.completeExpiredEventsDetailed();

    // The SE pass cleared the binding, so the row now matches the sweep's
    // filter too — only the exclusion keeps it from a second enqueue.
    const [row] = await app.db
      .select({ seId: schema.events.discordScheduledEventId })
      .from(schema.events)
      .where(eq(schema.events.id, id));
    expect(row?.seId).toBeNull();
    expect(enqueuedIds()).toEqual([id]);
    expect(run.embedOnlyEventIds).toBeUndefined();
  });
});

describe('findEmbedOnlyCompletionCandidates (ROK-1818)', () => {
  it('returns only ended, live-embed, non-ad-hoc, uncancelled events inside the lookback', async () => {
    const eligible = await seedEvent({ endedAgoMs: HOUR_MS });
    await seedEvent({ endedAgoMs: -HOUR_MS }); // still running
    await seedEvent({ endedAgoMs: 8 * DAY_MS }); // outside the 7-day lookback
    await seedEvent({ endedAgoMs: HOUR_MS, isAdHoc: true });
    await seedEvent({ endedAgoMs: HOUR_MS, cancelled: true });
    await seedEvent({ endedAgoMs: HOUR_MS, seId: 'se-still-bound' });
    await seedEvent({ endedAgoMs: HOUR_MS, embedState: null }); // never posted
    await seedEvent({
      endedAgoMs: HOUR_MS,
      extendedUntil: new Date(Date.now() + HOUR_MS),
    });

    expect(await findEmbedOnlyCompletionCandidates(app.db)).toEqual([eligible]);
    expect(await findEmbedOnlyCompletionCandidates(app.db, [eligible])).toEqual(
      [],
    );
  });
});
