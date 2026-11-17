/**
 * ROK-2217: `getPreferences` lazily creates the defaults row. Two concurrent
 * first reads for one user both insert; the loser's insert must be a no-op
 * (`onConflictDoNothing`) that re-reads the winner's row, never a 23505.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { DiscordNotificationService } from './discord-notification.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { CronJobService } from '../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

function prefsRow(userId: number) {
  return {
    userId,
    channelPrefs: { new_event: { inApp: false, push: true, discord: true } },
    updatedAt: new Date('2026-11-17T00:00:00Z'),
  };
}

describe('NotificationService.getPreferences — race-safe lazy create', () => {
  let service: NotificationService;
  let db: MockDb;

  beforeEach(async () => {
    db = createDrizzleMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: DrizzleAsyncProvider, useValue: db },
        { provide: DiscordNotificationService, useValue: null },
        { provide: ChannelResolverService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        {
          provide: CronJobService,
          useValue: { executeWithTracking: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(NotificationService);
  });

  it('returns the existing row without inserting', async () => {
    db.limit.mockResolvedValueOnce([prefsRow(7)]);
    const prefs = await service.getPreferences(7);
    expect(prefs.userId).toBe(7);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts defaults with onConflictDoNothing when no row exists', async () => {
    db.limit.mockResolvedValueOnce([]);
    db.returning.mockResolvedValueOnce([prefsRow(7)]);
    const prefs = await service.getPreferences(7);
    expect(prefs.userId).toBe(7);
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('re-selects the winner row when a concurrent insert won the race', async () => {
    db.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([prefsRow(7)]);
    db.returning.mockResolvedValueOnce([]);
    const prefs = await service.getPreferences(7);
    expect(db.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(prefs.userId).toBe(7);
    expect(prefs.channelPrefs.new_event?.inApp).toBe(false);
  });
});
