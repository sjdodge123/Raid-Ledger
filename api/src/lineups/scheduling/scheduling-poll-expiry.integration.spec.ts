/**
 * Scheduling-poll expiry warning + expired re-render (integration, ROK-1604).
 *
 * Real DB + real `NotificationDedupService` (the permanent dedup row IS the
 * idempotency contract); only `NotificationService.create` and
 * `SchedulingPollEmbedService.fireUpdateEmbed` are spied.
 *
 * Coverage:
 *   1. Deadline +11h, two voted slots -> ONE warning across two sweeps, to
 *      the creator, carrying the leader's slotId
 *   2. Redis dedup cache wiped ("restart") -> third sweep still one warning
 *   3. Deadline +13h -> no warning
 *   4. Locked in (`linked_event_id` set) -> no warning
 *   5. Zero votes -> no warning AND no dedup row left behind
 *   6. Deactivated creator -> no warning
 *   7. `create` throws once -> key released, next sweep sends
 *   8. Expired poll -> fireUpdateEmbed once across two sweeps, with OR
 *      without `embed_message_id` (the sync also nudges open poll pages)
 *
 * NOTE: requires `SchedulingPollExpiryService` registered in
 * `SchedulingModule` (Lead wiring).
 */
import type Redis from 'ioredis';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { SchedulingPollEmbedService } from './scheduling-poll-embed.service';
import { SchedulingPollExpiryService } from './scheduling-poll-expiry.service';

const HOUR_MS = 60 * 60 * 1000;

interface SeedOptions {
  deadlineHours: number;
  deactivatedCreator?: boolean;
  embedMessageId?: string | null;
  /** Hour offsets of slots; each entry's votes = the paired count. */
  slots?: Array<{ hours: number; votes: number }>;
}

interface Seeded {
  lineupId: number;
  matchId: number;
  creatorId: number;
  slotIds: number[];
}

function describeSchedulingPollExpiry(): void {
  let testApp: TestApp;
  let service: SchedulingPollExpiryService;
  let dedup: NotificationDedupService;
  let createSpy: jest.SpyInstance;
  let embedSpy: jest.SpyInstance;
  let tag = 0;

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(SchedulingPollExpiryService);
    dedup = testApp.app.get(NotificationDedupService);
  });

  beforeEach(() => {
    createSpy = jest
      .spyOn(testApp.app.get(NotificationService), 'create')
      .mockResolvedValue({ id: 'mock-notif' } as never);
    embedSpy = jest
      .spyOn(testApp.app.get(SchedulingPollEmbedService), 'fireUpdateEmbed')
      .mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function createUser(label: string, deactivated = false) {
    const suffix = `${label}-${++tag}`;
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:expiry-${suffix}`,
        username: `expiry-${suffix}`,
        role: 'member',
        deactivatedAt: deactivated ? new Date() : null,
      })
      .returning();
    return user.id;
  }

  async function insertLineupAndMatch(creatorId: number, opts: SeedOptions) {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name: `Expiry Game ${++tag}`, slug: `expiry-${tag}` })
      .returning();
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Expiry Poll',
        status: 'decided',
        visibility: 'public',
        createdBy: creatorId,
        includeSchedulingPhase: true,
        phaseDeadline: new Date(Date.now() + opts.deadlineHours * HOUR_MS),
        phaseDurationOverride: { standalone: true },
        publicSlug: generatePublicSlug(),
        publicShareEnabled: false,
      })
      .returning();
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId: game.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 1,
        embedMessageId: opts.embedMessageId ?? null,
        embedChannelId: opts.embedMessageId ? 'chan-1' : null,
      })
      .returning();
    return { lineupId: lineup.id, matchId: match.id };
  }

  /** Seed a poll with slots and `votes` distinct voters per slot. */
  async function seedPoll(label: string, opts: SeedOptions): Promise<Seeded> {
    const creatorId = await createUser(`${label}-c`, opts.deactivatedCreator);
    const ids = await insertLineupAndMatch(creatorId, opts);
    const slotIds: number[] = [];
    for (const s of opts.slots ?? [{ hours: 20, votes: 1 }]) {
      const [slot] = await testApp.db
        .insert(schema.communityLineupScheduleSlots)
        .values({
          matchId: ids.matchId,
          proposedTime: new Date(Date.now() + s.hours * HOUR_MS),
          suggestedBy: 'user',
        })
        .returning();
      slotIds.push(slot.id);
      for (let i = 0; i < s.votes; i++) {
        const userId = await createUser(`${label}-v${i}`);
        await testApp.db
          .insert(schema.communityLineupScheduleVotes)
          .values({ slotId: slot.id, userId });
      }
    }
    return { ...ids, creatorId, slotIds };
  }

  function warningsTo(userId: number): Array<Record<string, unknown>> {
    return createSpy.mock.calls
      .map((c: unknown[]) => c[0] as Record<string, unknown>)
      .filter((arg: Record<string, unknown>) => arg.userId === userId);
  }

  async function dedupRowCount(key: string): Promise<number> {
    const rows = await testApp.db.execute(
      sql`SELECT 1 FROM notification_dedup WHERE dedup_key = ${key}`,
    );
    return rows.length;
  }

  it('warns the creator exactly once with the leading slot', async () => {
    const poll = await seedPoll('once', {
      deadlineHours: 11,
      slots: [
        { hours: 20, votes: 1 },
        { hours: 30, votes: 2 },
      ],
    });

    await service.runSweep();
    await service.runSweep();

    const dms = warningsTo(poll.creatorId);
    expect(dms).toHaveLength(1);
    expect(dms[0].payload).toMatchObject({
      subtype: 'scheduling_poll_expiry_warning',
      lineupId: poll.lineupId,
      matchId: poll.matchId,
      slotId: poll.slotIds[1],
    });
  });

  it('stays at one warning after the Redis dedup cache is wiped', async () => {
    const poll = await seedPoll('restart', { deadlineHours: 11 });
    await service.runSweep();
    const key = `sched-poll-expiry-warn:${poll.matchId}`;
    const redis = (dedup as unknown as { redis: Redis }).redis;
    await redis.del(key);

    await service.runSweep();

    expect(warningsTo(poll.creatorId)).toHaveLength(1);
    expect(await dedupRowCount(key)).toBe(1);
  });

  it('does not warn when the deadline is 13h out', async () => {
    const poll = await seedPoll('far', { deadlineHours: 13 });
    await service.runSweep();
    expect(warningsTo(poll.creatorId)).toHaveLength(0);
  });

  it('does not warn a locked-in poll', async () => {
    const poll = await seedPoll('locked', { deadlineHours: 11 });
    const creator = await createUser('evt');
    const [event] = await testApp.db
      .insert(schema.events)
      .values({
        title: 'Locked',
        creatorId: creator,
        duration: [
          new Date(Date.now() + 20 * HOUR_MS),
          new Date(Date.now() + 22 * HOUR_MS),
        ],
      })
      .returning();
    await testApp.db
      .update(schema.communityLineupMatches)
      .set({ linkedEventId: event.id })
      .where(eq(schema.communityLineupMatches.id, poll.matchId));

    await service.runSweep();

    expect(warningsTo(poll.creatorId)).toHaveLength(0);
  });

  it('does not warn a zero-vote poll and leaves no dedup row', async () => {
    const poll = await seedPoll('novotes', {
      deadlineHours: 11,
      slots: [{ hours: 20, votes: 0 }],
    });
    await service.runSweep();
    expect(warningsTo(poll.creatorId)).toHaveLength(0);
    expect(await dedupRowCount(`sched-poll-expiry-warn:${poll.matchId}`)).toBe(
      0,
    );
  });

  it('does not warn a deactivated creator', async () => {
    const poll = await seedPoll('gone', {
      deadlineHours: 11,
      deactivatedCreator: true,
    });
    await service.runSweep();
    expect(warningsTo(poll.creatorId)).toHaveLength(0);
  });

  it('retries on the next sweep when dispatch throws', async () => {
    const poll = await seedPoll('retry', { deadlineHours: 11 });
    createSpy.mockRejectedValueOnce(new Error('dispatch exploded'));

    await expect(service.runSweep()).resolves.toEqual({ degraded: true });
    await service.runSweep();

    // Two attempts reached create: the failed one and the successful retry.
    expect(warningsTo(poll.creatorId)).toHaveLength(2);
    expect(await dedupRowCount(`sched-poll-expiry-warn:${poll.matchId}`)).toBe(
      1,
    );
  });

  it('syncs every expired poll exactly once, card or not', async () => {
    const posted = await seedPoll('expired', {
      deadlineHours: -1,
      embedMessageId: 'msg-1',
      slots: [{ hours: -2, votes: 1 }],
    });
    const unposted = await seedPoll('expired-nocard', {
      deadlineHours: -1,
      slots: [{ hours: -2, votes: 1 }],
    });

    await service.runSweep();
    await service.runSweep();

    expect(embedSpy).toHaveBeenCalledTimes(2);
    expect(embedSpy).toHaveBeenCalledWith(posted.matchId);
    expect(embedSpy).toHaveBeenCalledWith(unposted.matchId);
  });
}

describe(
  'Scheduling poll expiry warning (integration)',
  describeSchedulingPollExpiry,
);
