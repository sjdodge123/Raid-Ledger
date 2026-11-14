/**
 * Event DMs built outside the reminder path carry a planned temporary voice
 * channel (name + open time) the same way event reminders do — they spread
 * `NotificationService.resolveVoiceForEvent` into the payload.
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BENCH_PROMOTION_QUEUE,
  BenchPromotionProcessor,
} from './bench-promotion.service';
import { fetchNotificationContext } from './signups-notification.helpers';
import { notifyOrganizer } from '../discord-bot/processors/departure-grace.helpers';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { QueueHealthService } from '../queue/queue-health.service';

const PLANNED = { name: 'Raid Night', opensAt: '2026-11-20T19:45:00.000Z' };

function notificationMock() {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
    resolveVoiceForEvent: jest
      .fn()
      .mockResolvedValue({ plannedVoiceChannel: PLANNED }),
  };
}

describe('fetchNotificationContext — roster/departure DMs', () => {
  it('carries the planned temporary voice channel', async () => {
    const ns = notificationMock();
    const ctx = await fetchNotificationContext(
      ns as unknown as NotificationService,
      7,
    );
    expect(ctx).toEqual({ plannedVoiceChannel: PLANNED });
  });

  it('still carries a real channel link unchanged', async () => {
    const ns = notificationMock();
    ns.resolveVoiceForEvent.mockResolvedValue({ voiceChannelId: 'vc-1' });
    const ctx = await fetchNotificationContext(
      ns as unknown as NotificationService,
      7,
    );
    expect(ctx).toEqual({ voiceChannelId: 'vc-1' });
  });
});

describe('BenchPromotionProcessor — promoted-from-bench DM', () => {
  it('carries the planned temporary voice channel', async () => {
    const ns = notificationMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BenchPromotionProcessor,
        { provide: getQueueToken(BENCH_PROMOTION_QUEUE), useValue: {} },
        { provide: DrizzleAsyncProvider, useValue: {} },
        { provide: NotificationService, useValue: ns },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: QueueHealthService, useValue: {} },
      ],
    }).compile();
    const processor = moduleRef.get(BenchPromotionProcessor);
    await processor['notifyPromotedPlayer'](3, 7, 'Raid', 'tank', 1);
    expect(ns.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ plannedVoiceChannel: PLANNED }),
      }),
    );
  });
});

describe('notifyOrganizer — departure-grace "Member Departed" DM', () => {
  it('carries the planned temporary voice channel', async () => {
    const ns = notificationMock();
    await notifyOrganizer(
      { notificationService: ns as unknown as NotificationService },
      { creatorId: 99, title: 'Raid' },
      7,
      'RaidMember',
    );
    expect(ns.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'slot_vacated',
        payload: expect.objectContaining({ plannedVoiceChannel: PLANNED }),
      }),
    );
  });
});
