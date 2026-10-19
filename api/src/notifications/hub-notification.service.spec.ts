import { HubNotificationService } from './hub-notification.service';
import * as queries from './hub-notification.queries';
import { findAbsentUserIds } from './game-affinity-recipients.helpers';
import type { HubKindRegistry } from '../guilds/hub-kind.registry';
import type { NotificationService } from './notification.service';
import type { NotificationDedupService } from './notification-dedup.service';
import type * as schema from '../drizzle/schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

jest.mock('./hub-notification.queries');
jest.mock('./game-affinity-recipients.helpers', () => ({
  findAbsentUserIds: jest.fn(),
}));
const q = jest.mocked(queries);
const absent = jest.mocked(findAbsentUserIds);

const FUTURE = new Date(Date.now() + 86_400_000);

function setup(opts: { claimed?: boolean; marked?: boolean } = {}) {
  const adapter = { memberUserIds: jest.fn().mockResolvedValue([1, 2, 3]) };
  const registry = { forGuild: jest.fn().mockResolvedValue(adapter) };
  const notifications = { create: jest.fn().mockResolvedValue(null) };
  const dedup = {
    checkAndMarkSent: jest.fn().mockResolvedValue(opts.claimed ?? false),
    releaseKey: jest.fn().mockResolvedValue(undefined),
    isMarked: jest.fn().mockResolvedValue(opts.marked ?? true),
  };
  q.findGuildName.mockResolvedValue('Onyx');
  q.hasPostedEmbed.mockResolvedValue(false);
  q.findPriorEventNoticeUserIds.mockResolvedValue(new Set());
  absent.mockResolvedValue(new Set());
  q.filterGroupRecipients.mockImplementation((_db, ids) =>
    Promise.resolve([...ids]),
  );
  const svc = new HubNotificationService(
    {} as PostgresJsDatabase<typeof schema>,
    registry as unknown as HubKindRegistry,
    notifications as unknown as NotificationService,
    dedup as unknown as NotificationDedupService,
  );
  return { svc, registry, notifications, dedup };
}

function lateEvent(over: Partial<queries.LateTagEvent> = {}) {
  return {
    id: 9,
    title: 'Raid night',
    gameId: 4,
    guildId: 7,
    creatorId: 1,
    startTime: FUTURE,
    endTime: new Date(FUTURE.getTime() + 3_600_000),
    cancelledAt: null,
    ...over,
  };
}

describe('HubNotificationService.notifyLeaderPost (D3/D7)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('notifies every member but the author with the headline', async () => {
    const { svc, notifications, dedup } = setup();
    await svc.notifyLeaderPost({
      guildId: 7,
      actorId: 2,
      gmPost: 'Hi all\nmore',
    });
    expect(dedup.checkAndMarkSent).toHaveBeenCalledWith('hub-post:7', 3600);
    expect(notifications.create).toHaveBeenCalledTimes(2);
    expect(notifications.create).toHaveBeenCalledWith({
      userId: 1,
      type: 'hub_leader_post',
      title: 'New post in Onyx',
      message: 'Hi all',
      payload: { guildId: 7, guildName: 'Onyx', url: '/guilds/7' },
    });
  });

  it('sends nothing inside the cooldown', async () => {
    const { svc, notifications } = setup({ claimed: true });
    await svc.notifyLeaderPost({ guildId: 7, actorId: 2, gmPost: 'Edit' });
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('sends nothing for a blank post', async () => {
    const { svc, notifications, dedup } = setup();
    await svc.notifyLeaderPost({ guildId: 7, actorId: 2, gmPost: '  \n ' });
    expect(dedup.checkAndMarkSent).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('sends nothing when the kind has no live adapter', async () => {
    const { svc, registry, notifications } = setup();
    registry.forGuild.mockResolvedValue(undefined);
    await svc.notifyLeaderPost({ guildId: 7, actorId: 2, gmPost: 'Hi' });
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('claims no cooldown when resolving recipients throws', async () => {
    const { svc, registry, dedup } = setup();
    registry.forGuild.mockRejectedValue(new Error('db down'));
    await expect(
      svc.notifyLeaderPost({ guildId: 7, actorId: 2, gmPost: 'Hi' }),
    ).rejects.toThrow('db down');
    expect(dedup.checkAndMarkSent).not.toHaveBeenCalled();
  });

  it('gives the cooldown back when every send fails', async () => {
    const { svc, notifications, dedup } = setup();
    notifications.create.mockRejectedValue(new Error('boom'));
    await svc.notifyLeaderPost({ guildId: 7, actorId: 2, gmPost: 'Hi' });
    expect(dedup.checkAndMarkSent).toHaveBeenCalledWith('hub-post:7', 3600);
    expect(dedup.releaseKey).toHaveBeenCalledWith('hub-post:7');
  });
});

describe('HubNotificationService.notifyLateTag (D6b)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('notifies the group of an announced, upcoming event once per user', async () => {
    q.findLateTagEvent.mockResolvedValue(lateEvent());
    const { svc, notifications, dedup } = setup();
    await svc.notifyLateTag(9);
    expect(dedup.isMarked).toHaveBeenCalledWith('game-alert:event:9');
    expect(dedup.checkAndMarkSent).toHaveBeenCalledWith(
      'event-notice:9:user:2',
      expect.any(Number),
    );
    expect(notifications.create).toHaveBeenCalledTimes(2);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        type: 'hub_event_tagged',
        title: 'Raid night',
        message: 'Tagged to Onyx',
        payload: expect.objectContaining({ eventId: 9, guildId: 7, gameId: 4 }),
      }),
    );
  });

  it('skips a member away on the event date (ROK-503)', async () => {
    q.findLateTagEvent.mockResolvedValue(lateEvent());
    const { svc, notifications } = setup();
    absent.mockResolvedValue(new Set([2]));
    await svc.notifyLateTag(9);
    expect(absent).toHaveBeenCalledWith({}, [2, 3], FUTURE.toISOString());
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 3 }),
    );
  });

  it('does nothing before the event is announced', async () => {
    q.findLateTagEvent.mockResolvedValue(lateEvent());
    const { svc, notifications } = setup({ marked: false });
    await svc.notifyLateTag(9);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('does nothing once the event has started', async () => {
    q.findLateTagEvent.mockResolvedValue(lateEvent({ startTime: new Date(0) }));
    const { svc, notifications } = setup();
    await svc.notifyLateTag(9);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('does nothing for an untagged event', async () => {
    q.findLateTagEvent.mockResolvedValue(lateEvent({ guildId: null }));
    const { svc, notifications } = setup();
    await svc.notifyLateTag(9);
    expect(notifications.create).not.toHaveBeenCalled();
  });
});

describe('HubNotificationService.notifyLateTag announce + prior-notice dedup (Codex r1)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('treats an event whose embed the scheduler posted as announced', async () => {
    q.findLateTagEvent.mockResolvedValue(lateEvent());
    const { svc, notifications } = setup({ marked: false });
    q.hasPostedEmbed.mockResolvedValue(true);
    await svc.notifyLateTag(9);
    expect(q.hasPostedEmbed).toHaveBeenCalledWith({}, 9);
    expect(notifications.create).toHaveBeenCalledTimes(2);
  });

  it('skips a member who already has a notice for the event, and claims for them', async () => {
    q.findLateTagEvent.mockResolvedValue(lateEvent());
    const { svc, notifications, dedup } = setup();
    q.findPriorEventNoticeUserIds.mockResolvedValue(new Set([2]));
    await svc.notifyLateTag(9);
    expect(q.findPriorEventNoticeUserIds).toHaveBeenCalledWith({}, 9, [2, 3]);
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 3 }),
    );
    expect(dedup.checkAndMarkSent).toHaveBeenCalledWith(
      'event-notice:9:user:2',
      expect.any(Number),
    );
  });
});
