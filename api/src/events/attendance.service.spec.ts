import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

let service: AttendanceService;
let mockDb: Record<string, jest.Mock>;

const pastEvent = {
  id: 1,
  title: 'Past Raid',
  creatorId: 10,
  duration: [
    new Date('2026-01-01T18:00:00Z'),
    new Date('2026-01-01T20:00:00Z'),
  ],
};

const futureEvent = {
  id: 2,
  title: 'Future Raid',
  creatorId: 10,
  duration: [
    new Date('2027-12-01T18:00:00Z'),
    new Date('2027-12-01T20:00:00Z'),
  ],
};

const mockSignup = {
  id: 100,
  eventId: 1,
  userId: 20,
  note: null,
  signedUpAt: new Date('2026-01-01T17:00:00Z'),
  characterId: null,
  confirmationStatus: 'pending',
  status: 'signed_up',
  preferredRoles: null,
  attendanceStatus: null,
  attendanceRecordedAt: null,
  roachedOutAt: null,
  discordUserId: null,
  discordUsername: null,
  discordAvatarHash: null,
};

const mockUser = {
  id: 20,
  username: 'testplayer',
  discordId: '999',
  avatar: null,
  displayName: null,
  customAvatarUrl: null,
  role: 'member',
  onboardingCompletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function selectChainWith(value: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(value),
      }),
    }),
  };
}

function updateChainWith(value: unknown[]) {
  return {
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue(value),
      }),
    }),
  };
}

function joinedSelectChain(value: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      leftJoin: jest.fn().mockReturnValue({
        leftJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(value),
          }),
        }),
      }),
    }),
  };
}

async function setupEach() {
  mockDb = {};
  const chainMethods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'leftJoin',
    'innerJoin',
    'insert',
    'values',
    'returning',
    'update',
    'set',
    'delete',
    'groupBy',
  ];
  for (const m of chainMethods) {
    mockDb[m] = jest.fn().mockReturnThis();
  }

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AttendanceService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();

  service = module.get(AttendanceService);
}

async function testRecordAttendanceValid() {
  const updatedSignup = {
    ...mockSignup,
    attendanceStatus: 'attended',
    attendanceRecordedAt: new Date(),
  };

  mockDb.select
    .mockReturnValueOnce(selectChainWith([pastEvent]))
    .mockReturnValueOnce(selectChainWith([mockSignup]))
    .mockReturnValueOnce(selectChainWith([mockUser]));
  mockDb.update.mockReturnValueOnce(updateChainWith([updatedSignup]));

  const result = await service.recordAttendance(
    1,
    { signupId: 100, attendanceStatus: 'attended' },
    10,
    false,
  );

  expect(result).toMatchObject({
    id: expect.any(Number),
    eventId: expect.any(Number),
    attendanceStatus: 'attended',
  });
}

async function testRecordEventNotFound() {
  mockDb.select.mockReturnValueOnce(selectChainWith([]));
  await expect(
    service.recordAttendance(
      999,
      { signupId: 1, attendanceStatus: 'attended' },
      10,
      false,
    ),
  ).rejects.toThrow(NotFoundException);
}

async function testRecordEventNotEnded() {
  mockDb.select.mockReturnValueOnce(selectChainWith([futureEvent]));
  await expect(
    service.recordAttendance(
      2,
      { signupId: 1, attendanceStatus: 'attended' },
      10,
      false,
    ),
  ).rejects.toThrow(BadRequestException);
}

async function testRecordForbidden() {
  mockDb.select.mockReturnValueOnce(selectChainWith([pastEvent]));
  await expect(
    service.recordAttendance(
      1,
      { signupId: 1, attendanceStatus: 'attended' },
      99,
      false,
    ),
  ).rejects.toThrow(ForbiddenException);
}

async function testRecordAsAdmin() {
  const updatedSignup = {
    ...mockSignup,
    attendanceStatus: 'no_show',
    attendanceRecordedAt: new Date(),
  };

  mockDb.select
    .mockReturnValueOnce(selectChainWith([pastEvent]))
    .mockReturnValueOnce(selectChainWith([mockSignup]))
    .mockReturnValueOnce(selectChainWith([mockUser]));
  mockDb.update.mockReturnValueOnce(updateChainWith([updatedSignup]));

  const result = await service.recordAttendance(
    1,
    { signupId: 100, attendanceStatus: 'no_show' },
    99,
    true,
  );
  expect(result).toMatchObject({ attendanceStatus: 'no_show' });
}

async function testRecordSignupNotFound() {
  mockDb.select
    .mockReturnValueOnce(selectChainWith([pastEvent]))
    .mockReturnValueOnce(selectChainWith([]));

  await expect(
    service.recordAttendance(
      1,
      { signupId: 999, attendanceStatus: 'attended' },
      10,
      false,
    ),
  ).rejects.toThrow(NotFoundException);
}

async function testSummaryEventNotFound() {
  mockDb.select.mockReturnValueOnce(selectChainWith([]));
  await expect(service.getAttendanceSummary(999, 10, true)).rejects.toThrow(
    NotFoundException,
  );
}

async function testSummaryComputesStats() {
  const signups = [
    {
      event_signups: {
        ...mockSignup,
        id: 1,
        attendanceStatus: 'attended',
        attendanceRecordedAt: new Date(),
      },
      users: mockUser,
      characters: null,
    },
    {
      event_signups: {
        ...mockSignup,
        id: 2,
        userId: 21,
        attendanceStatus: 'no_show',
        attendanceRecordedAt: new Date(),
      },
      users: { ...mockUser, id: 21, username: 'player2' },
      characters: null,
    },
    {
      event_signups: {
        ...mockSignup,
        id: 3,
        userId: 22,
        attendanceStatus: null,
        attendanceRecordedAt: null,
      },
      users: { ...mockUser, id: 22, username: 'player3' },
      characters: null,
    },
  ];

  mockDb.select
    .mockReturnValueOnce(selectChainWith([pastEvent]))
    .mockReturnValueOnce(joinedSelectChain(signups));

  const result = await service.getAttendanceSummary(1, 10, true);

  expect(result).toMatchObject({
    eventId: 1,
    totalSignups: 3,
    attended: 1,
    noShow: 1,
    excused: 0,
    unmarked: 1,
    attendanceRate: 0.5,
    noShowRate: 0.5,
  });
  expect(result.signups).toHaveLength(3);
}

beforeEach(() => setupEach());

describe('AttendanceService — recordAttendance', () => {
  it('should record attendance for valid past event', () =>
    testRecordAttendanceValid());
  it('should throw NotFoundException when event missing', () =>
    testRecordEventNotFound());
  it('should throw BadRequestException when event not ended', () =>
    testRecordEventNotEnded());
  it('should throw ForbiddenException for non-creator/admin', () =>
    testRecordForbidden());
  it('should allow admin to record attendance', () => testRecordAsAdmin());
  it('should throw NotFoundException when signup missing', () =>
    testRecordSignupNotFound());
});

describe('AttendanceService — getAttendanceSummary', () => {
  it('should throw NotFoundException when event missing', () =>
    testSummaryEventNotFound());
  it('should compute correct summary stats', () => testSummaryComputesStats());
});
