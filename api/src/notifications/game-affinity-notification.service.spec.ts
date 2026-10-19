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
} from './hub-notification.queries';

jest.mock('./game-affinity-recipients.helpers', () => ({
  findGameAffinityRecipients: jest.fn(),
  findAbsentUserIds: jest.fn().mockResolvedValue(new Set()),
}));
jest.mock('./hub-notification.queries', () => ({
  findEventGuildId: jest.fn(),
  findGuildName: jest.fn().mockResolvedValue('Raiders'),
  findGroupTypeOff: jest.fn().mockResolvedValue(new Set()),
}));

const affinity = jest.mocked(findGameAffinityRecipients);
const guildOf = jest.mocked(findEventGuildId);
const typeOff = jest.mocked(findGroupTypeOff);

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
      payload: { eventId: 1, gameId: 5, guildId: 7, guildName: 'Raiders' },
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
