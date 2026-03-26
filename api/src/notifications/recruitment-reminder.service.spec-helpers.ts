import { Test, TestingModule } from '@nestjs/testing';
import { RecruitmentReminderService } from './recruitment-reminder.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from './notification.service';
import { NotificationDedupService } from './notification-dedup.service';
import { SettingsService } from '../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { CronJobService } from '../cron-jobs/cron-job.service';

/**
 * Helper to build a minimal EligibleEvent-shaped row returned from db.execute
 * for the findEligibleEvents query.
 */
export function makeEventRow(
  overrides: Partial<{
    id: number;
    title: string;
    game_id: number;
    game_name: string;
    creator_id: number;
    start_time: string;
    max_attendees: number | null;
    signup_count: string;
    channel_id: string;
    guild_id: string;
    message_id: string;
    created_at: string;
  }> = {},
) {
  return {
    id: 42,
    title: 'Mythic Raid Night',
    game_id: 7,
    game_name: 'World of Warcraft',
    creator_id: 1,
    start_time: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
    max_attendees: 20,
    signup_count: '10',
    channel_id: 'channel-abc',
    guild_id: 'guild-xyz',
    message_id: 'msg-123',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

export interface RecruitmentReminderTestMocks {
  mockDb: {
    execute: jest.Mock;
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
  };
  mockDedupService: { checkAndMarkSent: jest.Mock };
  mockNotificationService: {
    create: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  mockSettingsService: {
    getDefaultTimezone: jest.Mock;
    getClientUrl: jest.Mock;
  };
  mockDiscordBotClient: { isConnected: jest.Mock; sendEmbed: jest.Mock };
  mockCronJobService: { executeWithTracking: jest.Mock };
}

export async function createRecruitmentReminderTestModule(): Promise<{
  service: RecruitmentReminderService;
  mocks: RecruitmentReminderTestMocks;
}> {
  const mocks: RecruitmentReminderTestMocks = {
    mockDb: {
      execute: jest.fn(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
    },
    mockDedupService: {
      checkAndMarkSent: jest.fn().mockResolvedValue(false),
    },
    mockNotificationService: {
      create: jest.fn().mockResolvedValue({ id: 'notif-uuid-1' }),
      resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
    },
    mockSettingsService: {
      getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
      getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    },
    mockDiscordBotClient: {
      isConnected: jest.fn().mockReturnValue(true),
      sendEmbed: jest.fn().mockResolvedValue({ id: 'bump-msg-001' }),
    },
    mockCronJobService: {
      executeWithTracking: jest.fn((_name: string, fn: () => Promise<void>) =>
        fn(),
      ),
    },
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RecruitmentReminderService,
      { provide: DrizzleAsyncProvider, useValue: mocks.mockDb },
      {
        provide: NotificationDedupService,
        useValue: mocks.mockDedupService,
      },
      { provide: NotificationService, useValue: mocks.mockNotificationService },
      { provide: SettingsService, useValue: mocks.mockSettingsService },
      {
        provide: DiscordBotClientService,
        useValue: mocks.mockDiscordBotClient,
      },
      { provide: CronJobService, useValue: mocks.mockCronJobService },
    ],
  }).compile();

  return {
    service: module.get<RecruitmentReminderService>(RecruitmentReminderService),
    mocks,
  };
}
