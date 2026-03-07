import { NotFoundException } from '@nestjs/common';
import { SignupsService } from './signups.service';
import {
  createSignupsTestModule,
  type SignupsMocks,
} from './signups.spec-helpers';

let service: SignupsService;
let mockDb: Record<string, jest.Mock>;
let mockNotificationService: SignupsMocks['mockNotificationService'];
let mockRosterNotificationBuffer: SignupsMocks['mockRosterNotificationBuffer'];

const mockEvent = { id: 1, title: 'Test Event', creatorId: 99 };
const mockSignup = {
  id: 1,
  eventId: 1,
  userId: 1,
  note: null,
  signedUpAt: new Date(),
  characterId: null,
  confirmationStatus: 'pending',
};

const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
const mockEventDuration = {
  duration: [futureStart, new Date(futureStart.getTime() + 2 * 60 * 60 * 1000)],
};

function makeSelectChain(resolved: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(resolved),
      }),
    }),
  };
}

function mockSelectEventDuration() {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([mockEventDuration]),
      }),
    }),
  };
}

async function setupEach() {
  const setup = await createSignupsTestModule();
  service = setup.service;
  mockDb = setup.mockDb;
  mockNotificationService = setup.mockNotificationService;
  mockRosterNotificationBuffer = setup.mockRosterNotificationBuffer;
}

// ─── cancel tests ───────────────────────────────────────────────────────────

async function testCancelUnassigned() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockSignup]))
    .mockReturnValueOnce(mockSelectEventDuration())
    .mockReturnValueOnce(makeSelectChain([]));
  await service.cancel(1, 1);
  expect(mockDb.update).toHaveBeenCalled();
  expect(mockNotificationService.create).not.toHaveBeenCalled();
}

async function testCancelNotFound() {
  mockDb.select.mockReturnValueOnce(makeSelectChain([]));
  await expect(service.cancel(999, 1)).rejects.toThrow(NotFoundException);
}

async function testCancelWithAssignment() {
  const mockAssignment = {
    id: 10,
    signupId: 1,
    role: 'healer',
    position: 2,
    eventId: 1,
    isOverride: 0,
  };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockSignup]))
    .mockReturnValueOnce(mockSelectEventDuration())
    .mockReturnValueOnce(makeSelectChain([mockAssignment]))
    .mockReturnValueOnce(
      makeSelectChain([{ creatorId: 5, title: 'Raid Night' }]),
    )
    .mockReturnValueOnce(makeSelectChain([{ username: 'Frostmage' }]));
  await service.cancel(1, 1);
  expect(mockDb.delete).toHaveBeenCalled();
  expect(mockDb.update).toHaveBeenCalled();
  expect(mockRosterNotificationBuffer.bufferLeave).toHaveBeenCalledWith({
    organizerId: 5,
    eventId: 1,
    eventTitle: 'Raid Night',
    userId: 1,
    displayName: 'Frostmage',
    vacatedRole: 'healer',
  });
}

async function testCancelEventIdInPayload() {
  const mockAssignment = {
    id: 10,
    signupId: 1,
    role: 'tank',
    position: 1,
    eventId: 42,
    isOverride: 0,
  };
  const signup42 = { ...mockSignup, eventId: 42 };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([signup42]))
    .mockReturnValueOnce(mockSelectEventDuration())
    .mockReturnValueOnce(makeSelectChain([mockAssignment]))
    .mockReturnValueOnce(
      makeSelectChain([{ creatorId: 3, title: 'Weekly Clear' }]),
    )
    .mockReturnValueOnce(makeSelectChain([{ username: 'ShadowBlade' }]));
  await service.cancel(42, 1);
  expect(mockRosterNotificationBuffer.bufferLeave).toHaveBeenCalledWith(
    expect.objectContaining({ eventId: 42 }),
  );
}

// ─── selfUnassign tests ─────────────────────────────────────────────────────

const mockAssignment = {
  id: 10,
  signupId: 1,
  role: 'healer',
  position: 2,
  eventId: 1,
  isOverride: 0,
};

async function testSelfUnassignNoSignup() {
  mockDb.select.mockReturnValueOnce(makeSelectChain([]));
  await expect(service.selfUnassign(1, 99)).rejects.toThrow(NotFoundException);
}

async function testSelfUnassignNoAssignment() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockSignup]))
    .mockReturnValueOnce(makeSelectChain([]));
  await expect(service.selfUnassign(1, 1)).rejects.toThrow(NotFoundException);
}

async function testSelfUnassignSuccess() {
  const mockRoster = {
    eventId: 1,
    pool: [
      {
        id: 0,
        signupId: 1,
        userId: 1,
        discordId: '123',
        username: 'testuser',
        avatar: 'avatar.png',
        slot: null,
        position: 0,
        isOverride: false,
        character: null,
      },
    ],
    assignments: [],
    slots: { player: 10, bench: 5 },
  };
  jest
    .spyOn(service, 'getRosterWithAssignments')
    .mockResolvedValueOnce(mockRoster);
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockSignup]))
    .mockReturnValueOnce(makeSelectChain([mockAssignment]))
    .mockReturnValueOnce(
      makeSelectChain([{ creatorId: 5, title: 'Raid Night' }]),
    )
    .mockReturnValueOnce(makeSelectChain([{ username: 'Frostmage' }]));
  const result = await service.selfUnassign(1, 1);
  expect(mockDb.delete).toHaveBeenCalled();
  expect(mockRosterNotificationBuffer.bufferLeave).toHaveBeenCalledWith({
    organizerId: 5,
    eventId: 1,
    eventTitle: 'Raid Night',
    userId: 1,
    displayName: 'Frostmage',
    vacatedRole: 'healer',
  });
  expect(result.pool).toHaveLength(1);
  expect(result.assignments).toHaveLength(0);
}

async function testSelfUnassignKeepsSignup() {
  jest.spyOn(service, 'getRosterWithAssignments').mockResolvedValueOnce({
    eventId: 1,
    pool: [],
    assignments: [],
    slots: { player: 10, bench: 5 },
  });
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockSignup]))
    .mockReturnValueOnce(makeSelectChain([mockAssignment]))
    .mockReturnValueOnce(
      makeSelectChain([{ creatorId: 5, title: 'Raid Night' }]),
    )
    .mockReturnValueOnce(makeSelectChain([{ username: 'TestUser' }]));
  await service.selfUnassign(1, 1);
  expect(mockDb.delete).toHaveBeenCalledTimes(1);
}

beforeEach(() => setupEach());

describe('SignupsService — cancel', () => {
  it('should cancel unassigned signup without notification', () =>
    testCancelUnassigned());
  it('should throw NotFoundException when missing', () => testCancelNotFound());
  it('should dispatch notification when assigned', () =>
    testCancelWithAssignment());
  it('should include eventId in notification', () =>
    testCancelEventIdInPayload());
});

describe('SignupsService — selfUnassign', () => {
  it('should throw when signup missing', () => testSelfUnassignNoSignup());
  it('should throw when no assignment', () => testSelfUnassignNoAssignment());
  it('should delete assignment and notify', () => testSelfUnassignSuccess());
  it('should not delete signup itself', () => testSelfUnassignKeepsSignup());
});
