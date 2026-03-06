/**
 * Shared test helpers for ad-hoc-event.service spec files.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AdHocEventService } from './ad-hoc-event.service';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { SettingsService } from '../../settings/settings.service';
import { UsersService } from '../../users/users.service';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { VoiceAttendanceService } from './voice-attendance.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { createDrizzleMock, type MockDb } from '../../common/testing/drizzle-mock';

export const baseMember = {
  discordUserId: 'discord-123',
  discordUsername: 'TestPlayer',
  discordAvatarHash: 'avatar-hash',
  userId: 1,
};

export const baseBinding = {
  gameId: 1,
  config: {
    minPlayers: 2,
    gracePeriod: 5,
    notificationChannelId: 'channel-notif',
  },
};

export interface AdHocMocks {
  db: MockDb;
  settingsService: { get: jest.Mock };
  participantService: {
    addParticipant: jest.Mock;
    markLeave: jest.Mock;
    getRoster: jest.Mock;
    getActiveCount: jest.Mock;
    finalizeAll: jest.Mock;
  };
  channelBindingsService: { getBindingById: jest.Mock; getBindings: jest.Mock };
  usersService: { findByDiscordId: jest.Mock };
  gracePeriodQueue: { enqueue: jest.Mock; cancel: jest.Mock };
}

/** Set up the test module and return service + mocks. */
export async function setupAdHocTestModule(): Promise<{
  service: AdHocEventService;
  mocks: AdHocMocks;
}> {
  const db = createDrizzleMock();

  const mocks: AdHocMocks = {
    db,
    settingsService: { get: jest.fn() },
    participantService: {
      addParticipant: jest.fn().mockResolvedValue(undefined),
      markLeave: jest.fn().mockResolvedValue(undefined),
      getRoster: jest.fn().mockResolvedValue([]),
      getActiveCount: jest.fn().mockResolvedValue(0),
      finalizeAll: jest.fn().mockResolvedValue(undefined),
    },
    channelBindingsService: { getBindingById: jest.fn(), getBindings: jest.fn() },
    usersService: { findByDiscordId: jest.fn() },
    gracePeriodQueue: {
      enqueue: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
    },
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdHocEventService,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: SettingsService, useValue: mocks.settingsService },
      { provide: UsersService, useValue: mocks.usersService },
      { provide: AdHocParticipantService, useValue: mocks.participantService },
      { provide: ChannelBindingsService, useValue: mocks.channelBindingsService },
      { provide: AdHocGracePeriodQueueService, useValue: mocks.gracePeriodQueue },
      {
        provide: AdHocNotificationService,
        useValue: { notifySpawn: jest.fn(), queueUpdate: jest.fn(), notifyCompleted: jest.fn(), flush: jest.fn() },
      },
      {
        provide: AdHocEventsGateway,
        useValue: { emitRosterUpdate: jest.fn(), emitStatusChange: jest.fn(), emitEndTimeExtended: jest.fn() },
      },
      {
        provide: VoiceAttendanceService,
        useValue: { handleJoin: jest.fn(), handleLeave: jest.fn(), getActiveCount: jest.fn().mockReturnValue(0) },
      },
    ],
  }).compile();

  const service = module.get(AdHocEventService);
  jest.spyOn(service as any, 'autoSignupParticipant').mockResolvedValue(undefined);

  return { service, mocks };
}
