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
import { findGameAffinityRecipients } from './game-affinity-recipients.helpers';
import {
  findEventGuildId,
  findGroupTypeOff,
  findPriorEventNoticeUserIds,
} from './hub-notification.queries';
import { resolvePostEventFollowupRecipients } from './post-event-followup.helpers';

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
  create: jest.Mock;
  releaseKey: jest.Mock;
  claimed: Set<string>;
}

function build(groupIds: number[]): Harness {
  const claimed = new Set<string>();
  const create = jest.fn().mockResolvedValue({});
  const releaseKey = jest.fn((k: string) => {
    claimed.delete(k);
    return Promise.resolve();
  });
  const dedup = {
    checkAndMarkSent: jest.fn((k: string) => {
      const had = claimed.has(k);
      claimed.add(k);
      return Promise.resolve(had);
    }),
    releaseKey,
  } as unknown as NotificationDedupService;
  const notifications = {
    create,
    resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
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
  return { service, create, releaseKey, claimed };
}

function sentTypes(create: jest.Mock): Array<[number, string]> {
  return create.mock.calls.map((c: [{ userId: number; type: string }]) => [
    c[0].userId,
    c[0].type,
  ]);
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
    expect(sentTypes(h.create)).toEqual([[10, 'subscribed_game']]);
    expect(h.create.mock.calls[0]?.[0]).toMatchObject({
      message: 'Based on your interest in WoW',
    });
    expect(h.claimed.has('event-notice:1:user:10')).toBe(true);
  });

  it('a group member gets the group copy', async () => {
    affinity.mockResolvedValue([]);
    guildOf.mockResolvedValue(7);
    const h = build([20]);
    await h.service.notifyGameAffinity(input);
    expect(sentTypes(h.create)).toEqual([[20, 'hub_event_tagged']]);
    expect(h.create.mock.calls[0]?.[0]).toMatchObject({
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
    expect(sentTypes(h.create)).toEqual([[30, 'hub_event_tagged']]);
  });

  it('a group-muted affinity user (absent from the group set) gets the game copy', async () => {
    affinity.mockResolvedValue([40]);
    guildOf.mockResolvedValue(7);
    const h = build([]);
    await h.service.notifyGameAffinity(input);
    expect(sentTypes(h.create)).toEqual([[40, 'subscribed_game']]);
  });

  it('a user with the group type off gets the game copy', async () => {
    affinity.mockResolvedValue([50]);
    guildOf.mockResolvedValue(7);
    typeOff.mockResolvedValue(new Set([50]));
    const h = build([50]);
    await h.service.notifyGameAffinity(input);
    expect(sentTypes(h.create)).toEqual([[50, 'subscribed_game']]);
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
    expect(h.create).not.toHaveBeenCalled();
  });

  it('gives the per-user claim back when the send throws', async () => {
    affinity.mockResolvedValue([70]);
    guildOf.mockResolvedValue(null);
    const h = build([]);
    h.create.mockRejectedValue(new Error('boom'));
    await h.service.notifyGameAffinity(input);
    expect(h.releaseKey).toHaveBeenCalledWith('event-notice:1:user:70');
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
    expect(sentTypes(h.create)).toEqual([
      [20, 'hub_event_tagged'],
      [21, 'hub_event_tagged'],
    ]);
  });

  it('an event with neither a game nor a group sends nothing but is marked announced', async () => {
    guildOf.mockResolvedValue(null);
    const h = build([20]);
    await h.service.notifyGameAffinity(gameless);
    expect(h.create).not.toHaveBeenCalled();
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

  it('excludes them and claims their per-user notice so a late tag skips them', async () => {
    affinity.mockResolvedValue([10, 11]);
    guildOf.mockResolvedValue(null);
    followups.mockResolvedValue([11, 12]);
    const h = build([]);
    await h.service.notifyGameAffinity({ ...input, followupForEventId: 50 });
    expect(sentTypes(h.create)).toEqual([[10, 'subscribed_game']]);
    expect(h.claimed.has('event-notice:1:user:11')).toBe(true);
    expect(h.claimed.has('event-notice:1:user:12')).toBe(true);
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
    expect(sentTypes(h.create)).toEqual([[21, 'hub_event_tagged']]);
    expect(h.claimed.has('event-notice:1:user:20')).toBe(true);
  });

  it('skips the prior-notice lookup when the flag is unset', async () => {
    affinity.mockResolvedValue([10]);
    guildOf.mockResolvedValue(null);
    const h = build([]);
    await h.service.notifyGameAffinity(input);
    expect(priorHolders).not.toHaveBeenCalled();
    expect(sentTypes(h.create)).toEqual([[10, 'subscribed_game']]);
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
    expect(sentTypes(h.create)).toEqual([
      [20, 'hub_event_tagged'],
      [10, 'subscribed_game'],
    ]);
  });

  it('a group-only send after the full announcement notices nobody twice', async () => {
    const h = build([20]);
    await h.service.notifyGameAffinity(input);
    await h.service.notifyGameAffinity(groupOnly);
    expect(sentTypes(h.create)).toEqual([
      [20, 'hub_event_tagged'],
      [10, 'subscribed_game'],
    ]);
  });
});
