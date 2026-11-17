/**
 * ROK-1832 D4/D5/D6a — the announce path sends one notice per (user, event):
 * the group copy for group members, the game copy otherwise.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { GameAffinityNotificationService } from './game-affinity-notification.service';
import type { NotificationService } from './notification.service';
import type { NotificationDedupService } from './notification-dedup.service';
import type { HubNotificationService } from './hub-notification.service';
import {
  sendEventNotices,
  type EventNoticeDeps,
} from './event-notice-dispatch.helpers';
import { findGameAffinityRecipients } from './game-affinity-recipients.helpers';
import {
  findEventGuildId,
  findGroupTypeOff,
  findPriorEventNoticeUserIds,
} from './hub-notification.queries';
import { resolvePostEventFollowupRecipients } from './post-event-followup.helpers';
import {
  runFollowupFanout,
  type FollowupFanoutDeps,
} from './post-event-followup-fanout.helpers';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type {
  CreateNotificationInput,
  NotificationDto,
} from './notification.types';

jest.mock('./game-affinity-recipients.helpers', () => ({
  findGameAffinityRecipients: jest.fn(),
  findAbsentUserIds: jest.fn().mockResolvedValue(new Set()),
}));
jest.mock('./post-event-followup.helpers', () => ({
  resolvePostEventFollowupRecipients: jest.fn().mockResolvedValue([]),
}));
jest.mock('./hub-notification.queries', () => ({
  findEventGuildId: jest.fn(),
  findGuildName: jest.fn().mockResolvedValue('Raiders'),
  findGroupTypeOff: jest.fn().mockResolvedValue(new Set()),
  findPriorEventNoticeUserIds: jest.fn().mockResolvedValue(new Set()),
}));

const affinity = jest.mocked(findGameAffinityRecipients);
const guildOf = jest.mocked(findEventGuildId);
const typeOff = jest.mocked(findGroupTypeOff);
const followups = jest.mocked(resolvePostEventFollowupRecipients);
const priorHolders = jest.mocked(findPriorEventNoticeUserIds);

const input = {
  eventId: 1,
  eventTitle: 'Molten Core',
  gameName: 'WoW',
  gameId: 5,
  startTime: '2026-11-01T20:00:00.000Z',
  endTime: '2026-11-01T23:00:00.000Z',
  creatorId: 99,
};

interface Harness {
  service: GameAffinityNotificationService;
  /** ROK-2252: every event notice is written through one `createMany`. */
  createMany: jest.Mock<
    Promise<NotificationDto[]>,
    [CreateNotificationInput[]]
  >;
  releaseKeys: jest.Mock;
  claimed: Set<string>;
  deps: EventNoticeDeps;
}

function build(
  groupIds: number[],
  voice: Record<string, unknown> = {},
): Harness {
  const claimed = new Set<string>();
  const createMany = jest.fn((rows: CreateNotificationInput[]) =>
    Promise.resolve(rows.map(asCreated)),
  );
  const releaseKeys = jest.fn((keys: readonly string[]) => {
    keys.forEach((k) => claimed.delete(k));
    return Promise.resolve();
  });
  const dedup = {
    checkAndMarkSent: jest.fn((k: string) => {
      const had = claimed.has(k);
      claimed.add(k);
      return Promise.resolve(had);
    }),
    releaseKeys,
  } as unknown as NotificationDedupService;
  const notifications = {
    createMany,
    resolveVoiceForEvent: jest.fn().mockResolvedValue(voice),
  } as unknown as NotificationService;
  const hub = {
    resolveGroupEventRecipients: jest.fn().mockResolvedValue(groupIds),
  } as unknown as HubNotificationService;
  const db = {} as PostgresJsDatabase<typeof schema>;
  const service = new GameAffinityNotificationService(
    db,
    notifications,
    dedup,
    hub,
  );
  const deps = { notifications, dedup };
  return { service, createMany, releaseKeys, claimed, deps };
}

/** The row `createMany` returns for an input it actually created. */
function asCreated(i: CreateNotificationInput, n: number): NotificationDto {
  const { userId, type, title, message } = i;
  return { id: String(n), userId, type, title, message, createdAt: '' };
}

/**
 * A fake db for the follow-up fan-out (ended event 50, creator 99) whose
 * `notification_dedup` is the same `held` set the dedup service fake uses —
 * the real paths share that table.
 */
function fanoutDb(held: Set<string>): FollowupFanoutDeps['db'] {
  const dialect = new PgDialect();
  const execute = jest.fn((q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    if (text.includes('SET attendees_notified_at = now()')) {
      return Promise.resolve([{ id: 1 }]);
    }
    if (text.includes('SELECT id, title, creator_id')) {
      return Promise.resolve([{ id: 50, title: 'Raid', creator_id: 99 }]);
    }
    if (!text.includes('INSERT INTO notification_dedup')) {
      return Promise.resolve([]);
    }
    const keys = params.map(String).filter((p) => p.startsWith('event-'));
    const won = keys.filter((k) => !held.has(k));
    won.forEach((k) => held.add(k));
    return Promise.resolve(won.map((dedup_key) => ({ dedup_key })));
  });
  return { execute } as unknown as FollowupFanoutDeps['db'];
}

/** Every row handed to `createMany`, across all of its calls, in order. */
function sentRows(h: Harness): CreateNotificationInput[] {
  return h.createMany.mock.calls.flatMap(([rows]) => rows);
}

function sentTypes(h: Harness): Array<[number, string]> {
  return sentRows(h).map((r) => [r.userId, r.type]);
}

describe('GameAffinityNotificationService — merged event-notice plan', () => {
  beforeEach(() => {
    affinity.mockReset();
    guildOf.mockReset();
    typeOff.mockResolvedValue(new Set());
  });

  it('an affinity-only user keeps the game copy (untagged event)', async () => {
    affinity.mockResolvedValue([10]);
    guildOf.mockResolvedValue(null);
    const h = build([]);
    await h.service.notifyGameAffinity(input);
    expect(sentTypes(h)).toEqual([[10, 'subscribed_game']]);
    expect(sentRows(h)[0]).toMatchObject({
      message: 'Based on your interest in WoW',
    });
    expect(h.claimed.has('event-notice:1:user:10')).toBe(true);
  });

  it('a group member gets the group copy', async () => {
    affinity.mockResolvedValue([]);
    guildOf.mockResolvedValue(7);
    const h = build([20]);
    await h.service.notifyGameAffinity(input);
    expect(sentTypes(h)).toEqual([[20, 'hub_event_tagged']]);
    expect(sentRows(h)[0]).toMatchObject({
      title: 'Molten Core',
      message: 'Tagged to Raiders',
      payload: {
        eventId: 1,
        gameId: 5,
        guildId: 7,
        guildName: 'Raiders',
        url: '/events/1',
      },
    });
  });

  it('a user in both sets gets one notice — the group copy', async () => {
    affinity.mockResolvedValue([30]);
    guildOf.mockResolvedValue(7);
    const h = build([30]);
    await h.service.notifyGameAffinity(input);
    expect(sentTypes(h)).toEqual([[30, 'hub_event_tagged']]);
  });

  it('a group-muted affinity user (absent from the group set) gets the game copy', async () => {
    affinity.mockResolvedValue([40]);
    guildOf.mockResolvedValue(7);
    const h = build([]);
    await h.service.notifyGameAffinity(input);
    expect(sentTypes(h)).toEqual([[40, 'subscribed_game']]);
  });

  it('a user with the group type off gets the game copy', async () => {
    affinity.mockResolvedValue([50]);
    guildOf.mockResolvedValue(7);
    typeOff.mockResolvedValue(new Set([50]));
    const h = build([50]);
    await h.service.notifyGameAffinity(input);
    expect(sentTypes(h)).toEqual([[50, 'subscribed_game']]);
  });
});

describe('GameAffinityNotificationService — per-user claim (D4)', () => {
  beforeEach(() => {
    affinity.mockReset();
    guildOf.mockReset();
  });

  it('skips a user already noticed about this event (D4)', async () => {
    affinity.mockResolvedValue([60]);
    guildOf.mockResolvedValue(null);
    const h = build([]);
    h.claimed.add('event-notice:1:user:60');
    await h.service.notifyGameAffinity(input);
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it('gives the per-user claim back when the send throws', async () => {
    affinity.mockResolvedValue([70]);
    guildOf.mockResolvedValue(null);
    const h = build([]);
    h.createMany.mockRejectedValue(new Error('boom'));
    await h.service.notifyGameAffinity(input);
    expect(h.releaseKeys).toHaveBeenCalledWith(['event-notice:1:user:70']);
    expect(h.claimed.has('event-notice:1:user:70')).toBe(false);
  });
});

describe('GameAffinityNotificationService — game-less events (ROK-1832 B2)', () => {
  const gameless = { ...input, gameId: null, gameName: null };

  beforeEach(() => {
    affinity.mockReset();
    guildOf.mockReset();
    typeOff.mockResolvedValue(new Set());
  });

  it('a group-tagged event with no game sends the group copy only', async () => {
    guildOf.mockResolvedValue(7);
    const h = build([20, 21]);
    await h.service.notifyGameAffinity(gameless);
    expect(affinity).not.toHaveBeenCalled();
    expect(sentTypes(h)).toEqual([
      [20, 'hub_event_tagged'],
      [21, 'hub_event_tagged'],
    ]);
  });

  it('an event with neither a game nor a group sends nothing but is marked announced', async () => {
    guildOf.mockResolvedValue(null);
    const h = build([20]);
    await h.service.notifyGameAffinity(gameless);
    expect(h.createMany).not.toHaveBeenCalled();
    // The late-tag path (D6b) keys on this mark, so a later group tag notifies.
    expect([...h.claimed]).toEqual(['game-alert:event:1']);
  });
});

describe('GameAffinityNotificationService — follow-up attendees (ROK-1371)', () => {
  beforeEach(() => {
    affinity.mockReset();
    guildOf.mockReset();
    followups.mockReset();
  });

  it('excludes them without claiming their per-user notice keys (Codex r9)', async () => {
    affinity.mockResolvedValue([10, 11]);
    guildOf.mockResolvedValue(null);
    followups.mockResolvedValue([11, 12]);
    const h = build([]);
    await h.service.notifyGameAffinity({ ...input, followupForEventId: 50 });
    expect(sentTypes(h)).toEqual([[10, 'subscribed_game']]);
    expect([...h.claimed].sort()).toEqual([
      'event-notice:1:user:10',
      'game-alert:event:1',
    ]);
  });

  it('a follow-up fan-out that runs after it still notifies those attendees', async () => {
    affinity.mockResolvedValue([10, 11]);
    guildOf.mockResolvedValue(null);
    followups.mockResolvedValue([11, 12]);
    const h = build([]);
    await h.service.notifyGameAffinity({ ...input, followupForEventId: 50 });
    const createMany = jest.fn((rows: CreateNotificationInput[]) =>
      Promise.resolve(rows.map(asCreated)),
    );
    await runFollowupFanout(
      {
        db: fanoutDb(h.claimed),
        notificationService: { createMany },
        noticeDedup: { releaseKeys: jest.fn() },
      },
      50,
      { eventId: 1 },
      99,
    );
    const sent = createMany.mock.calls[0]?.[0].map((r) => r.userId);
    expect(sent).toEqual([11, 12]);
  });
});

describe('GameAffinityNotificationService — durable prior notices (Codex r4)', () => {
  beforeEach(() => {
    affinity.mockReset();
    guildOf.mockReset();
    priorHolders.mockReset();
  });

  it('a user holding a prior follow-up notice gets nothing from the deferred announce', async () => {
    affinity.mockResolvedValue([]);
    guildOf.mockResolvedValue(7);
    priorHolders.mockResolvedValue(new Set([20]));
    const h = build([20, 21]);
    await h.service.notifyGameAffinity({
      ...input,
      gameId: null,
      gameName: null,
      excludePriorNoticeHolders: true,
    });
    expect(sentTypes(h)).toEqual([[21, 'hub_event_tagged']]);
    expect(h.claimed.has('event-notice:1:user:20')).toBe(true);
  });

  it('skips the prior-notice lookup when the flag is unset', async () => {
    affinity.mockResolvedValue([10]);
    guildOf.mockResolvedValue(null);
    const h = build([]);
    await h.service.notifyGameAffinity(input);
    expect(priorHolders).not.toHaveBeenCalled();
    expect(sentTypes(h)).toEqual([[10, 'subscribed_game']]);
  });
});

describe('GameAffinityNotificationService — group-only scheduler send (Codex r7)', () => {
  const groupOnly = {
    ...input,
    gameId: null,
    gameName: null,
    excludePriorNoticeHolders: true,
    groupOnly: true,
  };

  beforeEach(() => {
    affinity.mockReset();
    guildOf.mockReset();
    priorHolders.mockReset();
    priorHolders.mockResolvedValue(new Set());
    affinity.mockResolvedValue([10, 20]);
    guildOf.mockResolvedValue(7);
  });

  it('leaves the full-announcement claim free for the later lifecycle job', async () => {
    const h = build([20]);
    await h.service.notifyGameAffinity(groupOnly);
    expect(h.claimed.has('game-alert:event:1')).toBe(false);
    await h.service.notifyGameAffinity(input);
    // 10 is outside the group: only the full announcement reaches them.
    expect(sentTypes(h)).toEqual([
      [20, 'hub_event_tagged'],
      [10, 'subscribed_game'],
    ]);
  });

  it('a group-only send after the full announcement notices nobody twice', async () => {
    const h = build([20]);
    await h.service.notifyGameAffinity(input);
    await h.service.notifyGameAffinity(groupOnly);
    expect(sentTypes(h)).toEqual([
      [20, 'hub_event_tagged'],
      [10, 'subscribed_game'],
    ]);
  });
});

describe('GameAffinityNotificationService — planned temporary voice channel', () => {
  it('the new-event notice carries the planned channel name + open time', async () => {
    const planned = { name: 'Raid Night', opensAt: '2026-11-20T19:45:00.000Z' };
    affinity.mockResolvedValue([10]);
    guildOf.mockResolvedValue(null);
    const h = build([], { plannedVoiceChannel: planned });
    await h.service.notifyGameAffinity(input);
    expect(sentRows(h)[0]).toMatchObject({
      payload: { plannedVoiceChannel: planned },
    });
  });
});

describe('sendEventNotices — one batched write (ROK-2252)', () => {
  const copy = { eventId: 1, title: 'MC', gameName: 'WoW', payload: {} };
  const sent = { status: 'fulfilled', value: true };
  const notSent = { status: 'fulfilled', value: false };

  it('N recipients cost ONE createMany carrying N rows, each settled true', async () => {
    const h = build([]);
    const results = await sendEventNotices(h.deps, copy, [1, 2, 3], null);
    expect(h.createMany).toHaveBeenCalledTimes(1);
    expect(sentTypes(h)).toEqual([
      [1, 'subscribed_game'],
      [2, 'subscribed_game'],
      [3, 'subscribed_game'],
    ]);
    expect(results).toEqual([sent, sent, sent]);
  });

  it('a user already noticed is left out of the batch and keeps their claim', async () => {
    const h = build([]);
    h.claimed.add('event-notice:1:user:2');
    const results = await sendEventNotices(h.deps, copy, [1, 2], null);
    expect(sentTypes(h)).toEqual([[1, 'subscribed_game']]);
    expect(results).toEqual([sent, notSent]);
    expect(h.releaseKeys).not.toHaveBeenCalled();
    expect(h.claimed.has('event-notice:1:user:2')).toBe(true);
  });

  it('a row createMany skips (in-app off) settles false and gives its claim back', async () => {
    const h = build([]);
    h.createMany.mockImplementation((rows) =>
      Promise.resolve(rows.filter((r) => r.userId !== 2).map(asCreated)),
    );
    const results = await sendEventNotices(h.deps, copy, [1, 2, 3], null);
    expect(results).toEqual([sent, notSent, sent]);
    expect(h.releaseKeys).toHaveBeenCalledTimes(1);
    expect(h.releaseKeys).toHaveBeenCalledWith(['event-notice:1:user:2']);
    expect([...h.claimed].sort()).toEqual([
      'event-notice:1:user:1',
      'event-notice:1:user:3',
    ]);
  });

  it('a failed batch rejects every claimed notice and gives all claims back in one call', async () => {
    const h = build([]);
    h.claimed.add('event-notice:1:user:3');
    h.createMany.mockRejectedValue(new Error('boom'));
    const results = await sendEventNotices(h.deps, copy, [1, 2, 3], null);
    expect(results.map((r) => r.status)).toEqual([
      'rejected',
      'rejected',
      'fulfilled',
    ]);
    expect(h.releaseKeys).toHaveBeenCalledWith([
      'event-notice:1:user:1',
      'event-notice:1:user:2',
    ]);
    expect([...h.claimed]).toEqual(['event-notice:1:user:3']);
  });

  it('nobody left to notice: no createMany at all', async () => {
    const h = build([]);
    h.claimed.add('event-notice:1:user:1');
    expect(await sendEventNotices(h.deps, copy, [1], null)).toEqual([notSent]);
    expect(h.createMany).not.toHaveBeenCalled();
  });
});
