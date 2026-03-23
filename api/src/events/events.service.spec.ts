import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventsService } from './events.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { AvailabilityService } from '../availability/availability.service';
import { NotificationService } from '../notifications/notification.service';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { ActivityLogService } from '../activity-log/activity-log.service';

let service: EventsService;
let mockDb: MockDb;

const mockUser = {
  id: 1,
  username: 'testuser',
  avatar: null,
  discordId: '123',
  role: 'member',
};
const mockGame = {
  id: 1,
  igdbId: 1234,
  name: 'Valheim',
  slug: 'valheim',
  coverUrl: null,
};
const mockEvent = {
  id: 1,
  title: 'Test Event',
  description: 'Test description',
  gameId: '1',
  creatorId: 1,
  duration: [
    new Date('2026-02-10T18:00:00Z'),
    new Date('2026-02-10T20:00:00Z'),
  ] as [Date, Date],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Joined row shape returned by findOne / findAll queries */
const defaultRow = {
  events: mockEvent,
  users: mockUser,
  games: mockGame,
  signupCount: 0,
};

async function setupEach() {
  mockDb = createDrizzleMock();
  mockDb.returning.mockResolvedValue([mockEvent]);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EventsService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: AvailabilityService,
        useValue: {
          findForUsersInRange: jest.fn().mockResolvedValue(new Map()),
        },
      },
      {
        provide: NotificationService,
        useValue: { create: jest.fn() },
      },
      {
        provide: EventEmitter2,
        useValue: {
          emit: jest.fn(),
          emitAsync: jest.fn().mockResolvedValue([]),
        },
      },
      {
        provide: ActivityLogService,
        useValue: {
          log: jest.fn().mockResolvedValue(undefined),
          getTimeline: jest.fn().mockResolvedValue({ data: [] }),
        },
      },
    ],
  }).compile();

  service = module.get<EventsService>(EventsService);
}

async function testCreateEvent() {
  mockDb.limit.mockResolvedValueOnce([defaultRow]);

  const dto = {
    title: 'New Event',
    description: 'Description',
    startTime: '2026-02-10T18:00:00Z',
    endTime: '2026-02-10T20:00:00Z',
    gameId: 1,
  };

  const result = await service.create(1, dto);

  expect(result).toMatchObject({
    id: expect.any(Number),
    title: expect.any(String),
    creator: expect.objectContaining({ username: expect.any(String) }),
  });
  expect(mockDb.insert).toHaveBeenCalled();
}

async function testFindOneReturnsEvent() {
  mockDb.limit.mockResolvedValueOnce([defaultRow]);
  const result = await service.findOne(1);
  expect(result).toMatchObject({
    id: expect.any(Number),
    creator: expect.objectContaining({ username: expect.any(String) }),
  });
}

async function testFindOneThrowsNotFound() {
  mockDb.limit.mockResolvedValueOnce([]);
  await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
}

async function testUpdateAsCreator() {
  mockDb.limit
    .mockResolvedValueOnce([mockEvent])
    .mockResolvedValueOnce([defaultRow]);

  const result = await service.update(1, 1, false, {
    title: 'Updated Title',
  });

  expect(result).toMatchObject({ id: expect.any(Number) });
  expect(mockDb.update).toHaveBeenCalled();
}

async function testUpdateAsAdmin() {
  mockDb.limit
    .mockResolvedValueOnce([mockEvent])
    .mockResolvedValueOnce([defaultRow]);

  const result = await service.update(1, 999, true, {
    title: 'Updated Title',
  });

  expect(result).toMatchObject({ id: expect.any(Number) });
  expect(mockDb.update).toHaveBeenCalled();
}

async function testUpdateForbidden() {
  mockDb.limit.mockResolvedValueOnce([mockEvent]);
  await expect(
    service.update(1, 999, false, { title: 'Updated Title' }),
  ).rejects.toThrow(ForbiddenException);
}

async function testDeleteAsCreator() {
  mockDb.limit.mockResolvedValueOnce([mockEvent]);
  await service.delete(1, 1, false);
  expect(mockDb.delete).toHaveBeenCalled();
}

async function testDeleteForbidden() {
  mockDb.limit.mockResolvedValueOnce([mockEvent]);
  await expect(service.delete(1, 999, false)).rejects.toThrow(
    ForbiddenException,
  );
}

beforeEach(() => setupEach());

describe('EventsService — create', () => {
  it('should create an event and return it with creator info', () =>
    testCreateEvent());
});

describe('EventsService — findOne', () => {
  it('should return an event with creator info', () =>
    testFindOneReturnsEvent());
  it('should throw NotFoundException when event not found', () =>
    testFindOneThrowsNotFound());
});

describe('EventsService — update', () => {
  it('should update when user is creator', () => testUpdateAsCreator());
  it('should update when user is admin', () => testUpdateAsAdmin());
  it('should throw ForbiddenException when not creator or admin', () =>
    testUpdateForbidden());
});

describe('EventsService — delete', () => {
  it('should delete when user is creator', () => testDeleteAsCreator());
  it('should throw ForbiddenException when not creator or admin', () =>
    testDeleteForbidden());
});
