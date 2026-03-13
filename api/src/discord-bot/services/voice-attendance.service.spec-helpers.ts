import { Test, TestingModule } from '@nestjs/testing';
import { VoiceAttendanceService } from './voice-attendance.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

/** Shared mock types for voice attendance service tests. */
export interface VoiceAttendanceMocks {
  service: VoiceAttendanceService;
  mockDb: MockDb;
  mockGetBindings: jest.Mock;
  mockGetGuildId: jest.Mock;
  mockGetDefaultVoice: jest.Mock;
}

/** Set up the shared test module and return all mocks. */
export async function setupVoiceAttendanceTestModule(): Promise<VoiceAttendanceMocks> {
  const mockDb = createDrizzleMock();
  const mockGetBindings = jest.fn().mockResolvedValue([]);
  const mockGetGuildId = jest.fn().mockReturnValue('guild-1');
  const mockGetDefaultVoice = jest.fn().mockResolvedValue(null);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      VoiceAttendanceService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: SettingsService,
        useValue: {
          get: jest.fn().mockResolvedValue('5'),
          getDiscordBotDefaultVoiceChannel: mockGetDefaultVoice,
        },
      },
      {
        provide: CronJobService,
        useValue: {
          executeWithTracking: jest
            .fn()
            .mockImplementation((_: string, fn: () => Promise<void>) => fn()),
        },
      },
      {
        provide: ChannelBindingsService,
        useValue: { getBindings: mockGetBindings },
      },
      {
        provide: DiscordBotClientService,
        useValue: { getClient: jest.fn(), getGuildId: mockGetGuildId },
      },
      {
        provide: ChannelResolverService,
        useValue: { resolveVoiceChannelForEvent: jest.fn() },
      },
    ],
  }).compile();

  return {
    service: module.get(VoiceAttendanceService),
    mockDb,
    mockGetBindings,
    mockGetGuildId,
    mockGetDefaultVoice,
  };
}

/** Create event timing for classifyVoiceSession tests. */
export function eventWindow(durationHours: number) {
  const start = new Date('2026-02-28T20:00:00Z');
  const end = new Date(start.getTime() + durationHours * 3600_000);
  const durationSec = durationHours * 3600;
  const graceMs = 5 * 60 * 1000; // 5 minutes
  return { start, end, durationSec, graceMs };
}
