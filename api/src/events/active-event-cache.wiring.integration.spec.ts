/**
 * DI wiring pin for the active-event cache consumers.
 *
 * `@Optional() x: ActiveEventCacheService | null` emits `design:paramtypes`
 * `Object` for the union, so without an explicit `@Inject(token)` Nest
 * resolves that parameter to `undefined`. `@Optional` swallows the miss, so
 * boot never fails and every cache short-circuit silently becomes a no-op.
 * Nothing but this spec can see it: each row resolves a consumer from the real
 * AppModule graph and asserts its private field holds the SAME singleton the
 * container hands out.
 */
import type { INestApplication, Type } from '@nestjs/common';
import { getTestApp } from '../common/testing/test-app';
import { ActiveEventCacheService } from './active-event-cache.service';
import { EventAutoExtendService } from '../discord-bot/services/event-auto-extend.service';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { ScheduledEventService } from '../discord-bot/services/scheduled-event.service';
import { LfgNowSpawnService } from '../discord-bot/lfg-now/lfg-now-spawn.service';
import { EmbedSyncQueueService } from '../discord-bot/queues/embed-sync.queue';
import { PostEventFollowupService } from '../notifications/post-event-followup.service';
import { PostEventReminderService } from '../notifications/post-event-reminder.service';
import { EventReminderService } from '../notifications/event-reminder.service';
import { LiveNoShowService } from '../notifications/live-noshow.service';

/** Reads a private constructor field by name, without bare index access. */
function privateField(instance: unknown, field: string): unknown {
  return Reflect.get(instance as object, field);
}

describe('ActiveEventCacheService DI wiring (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = (await getTestApp()).app;
  });

  it.each<[string, Type<unknown>]>([
    ['EventAutoExtendService', EventAutoExtendService],
    ['VoiceAttendanceService', VoiceAttendanceService],
    ['ScheduledEventService', ScheduledEventService],
    ['PostEventFollowupService', PostEventFollowupService],
    ['PostEventReminderService', PostEventReminderService],
    ['EventReminderService', EventReminderService],
    ['LiveNoShowService', LiveNoShowService],
    ['LfgNowSpawnService', LfgNowSpawnService],
  ])('%s receives the shared ActiveEventCacheService', (_name, consumer) => {
    const cache = app.get(ActiveEventCacheService, { strict: false });
    // Guard against a vacuous `undefined toBe undefined` pass.
    expect(cache).toBeInstanceOf(ActiveEventCacheService);
    const instance = app.get(consumer, { strict: false });
    expect(privateField(instance, 'eventCache')).toBe(cache);
  });

  it('ScheduledEventService receives the shared EmbedSyncQueueService', () => {
    const queue = app.get(EmbedSyncQueueService, { strict: false });
    expect(queue).toBeInstanceOf(EmbedSyncQueueService);
    const instance = app.get(ScheduledEventService, { strict: false });
    expect(privateField(instance, 'embedSyncQueue')).toBe(queue);
  });
});
