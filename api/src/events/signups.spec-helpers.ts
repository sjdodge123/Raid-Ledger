import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';

/** Shared mock types for signups service tests */
export interface SignupsMocks {
  service: SignupsService;
  mockDb: Record<string, jest.Mock>;
  mockNotificationService: {
    create: jest.Mock;
    getDiscordEmbedUrl: jest.Mock;
    resolveVoiceChannelForEvent: jest.Mock;
  };
  mockRosterNotificationBuffer: {
    bufferLeave: jest.Mock;
    bufferJoin: jest.Mock;
  };
  mockBenchPromotionService: {
    schedulePromotion: jest.Mock;
    cancelPromotion: jest.Mock;
    isEligible: jest.Mock;
  };
  mockEventEmitter: { emit: jest.Mock };
}

/** Shared test fixtures */
export const mockUser = {
  id: 1,
  username: 'testuser',
  avatar: 'avatar.png',
  discordId: '123',
  role: 'member',
};
export const mockEvent = { id: 1, title: 'Test Event', creatorId: 99 };
export const mockSignup = {
  id: 1,
  eventId: 1,
  userId: 1,
  note: null,
  signedUpAt: new Date(),
  characterId: null,
  confirmationStatus: 'pending',
};
export const mockCharacter = {
  id: 'char-uuid-1',
  userId: 1,
  gameId: 'game-uuid-1',
  name: 'Frostweaver',
  realm: 'Area52',
  class: 'Mage',
  spec: 'Arcane',
  role: 'dps',
  isMain: true,
  itemLevel: 485,
  avatarUrl: null,
  externalId: null,
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildMockServices() {
  const mockNotificationService = {
    create: jest.fn().mockResolvedValue(null),
    getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
    resolveVoiceChannelForEvent: jest.fn().mockResolvedValue(null),
  };
  const mockRosterNotificationBuffer = {
    bufferLeave: jest.fn(),
    bufferJoin: jest.fn(),
  };
  const mockBenchPromotionService = {
    schedulePromotion: jest.fn().mockResolvedValue(undefined),
    cancelPromotion: jest.fn().mockResolvedValue(undefined),
    isEligible: jest.fn().mockResolvedValue(false),
  };
  const mockEventEmitter = { emit: jest.fn() };
  return {
    mockNotificationService,
    mockRosterNotificationBuffer,
    mockBenchPromotionService,
    mockEventEmitter,
  };
}

function buildSelectChain(): Record<string, jest.Mock> {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([mockEvent]),
      }),
      leftJoin: jest.fn().mockReturnValue({
        leftJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([]),
          }),
        }),
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
  };
}

function buildInsertChain(): Record<string, jest.Mock> {
  return {
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockSignup]),
      }),
      returning: jest.fn().mockResolvedValue([mockSignup]),
    }),
  };
}

function buildDeleteChain(): Record<string, jest.Mock> {
  return {
    where: jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([mockSignup]),
    }),
  };
}

function buildUpdateChain(): Record<string, jest.Mock> {
  return {
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockSignup]),
      }),
    }),
  };
}

function buildMockDb(): Record<string, jest.Mock> {
  const mockDb: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnValue(buildSelectChain()),
    insert: jest.fn().mockReturnValue(buildInsertChain()),
    delete: jest.fn().mockReturnValue(buildDeleteChain()),
    update: jest.fn().mockReturnValue(buildUpdateChain()),
    transaction: jest.fn(),
  };

  mockDb.transaction.mockImplementation(
    async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
  );

  return mockDb;
}

/** Build the NestJS testing module with all mocked providers */
export async function createSignupsTestModule(): Promise<SignupsMocks> {
  const services = buildMockServices();
  const mockDb = buildMockDb();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SignupsService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: NotificationService,
        useValue: services.mockNotificationService,
      },
      {
        provide: RosterNotificationBufferService,
        useValue: services.mockRosterNotificationBuffer,
      },
      {
        provide: BenchPromotionService,
        useValue: services.mockBenchPromotionService,
      },
      { provide: EventEmitter2, useValue: services.mockEventEmitter },
    ],
  }).compile();

  return {
    service: module.get<SignupsService>(SignupsService),
    mockDb,
    ...services,
  };
}
