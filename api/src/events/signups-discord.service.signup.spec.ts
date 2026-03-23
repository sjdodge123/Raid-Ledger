/**
 * Unit tests for ROK-137 Discord signup methods — signupDiscord & ROK-451 auto-slot.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';
import { SignupsAllocationService } from './signups-allocation.service';
import { SignupsRosterService } from './signups-roster.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

const mockEvent = {
  id: 1,
  title: 'Raid Night',
  creatorId: 5,
  maxAttendees: null,
  slotConfig: null,
  gameId: null,
};
const mockUser = {
  id: 1,
  username: 'linkeduser',
  avatar: 'avatar.png',
  discordId: 'discord-user-123',
  role: 'member',
  displayName: null,
  customAvatarUrl: null,
};
const mockAnonymousSignup = {
  id: 10,
  eventId: 1,
  userId: null,
  discordUserId: 'discord-anon-456',
  discordUsername: 'AnonUser',
  discordAvatarHash: 'avatar-hash-abc',
  note: null,
  signedUpAt: new Date(),
  characterId: null,
  confirmationStatus: 'confirmed',
  status: 'signed_up',
};

function makeSelectChain(resolvedValue: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(resolvedValue),
      }),
      innerJoin: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeSelectChainNoLimit(resolvedValue: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(resolvedValue),
    }),
  };
}

function createMockDb() {
  const db: Record<string, jest.Mock> = {
    select: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(),
  };
  db.insert.mockReturnValue({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
      }),
      returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
    }),
  });
  db.delete.mockReturnValue({
    where: jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([]),
    }),
  });
  db.update.mockReturnValue({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
      }),
    }),
  });
  db.transaction.mockImplementation(
    async (cb: (tx: typeof db) => Promise<unknown>) => cb(db),
  );
  return db;
}

let service: SignupsService;
let mockDb: Record<string, jest.Mock>;

async function setupEach() {
  mockDb = createMockDb();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SignupsService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      {
        provide: NotificationService,
        useValue: { create: jest.fn().mockResolvedValue(null) },
      },
      {
        provide: RosterNotificationBufferService,
        useValue: { bufferLeave: jest.fn(), bufferJoin: jest.fn() },
      },
      {
        provide: BenchPromotionService,
        useValue: {
          schedulePromotion: jest.fn(),
          cancelPromotion: jest.fn(),
          isEligible: jest.fn().mockResolvedValue(false),
        },
      },
      {
        provide: SignupsAllocationService,
        useValue: {
          autoAllocateSignup: jest.fn(),
          promoteFromBench: jest.fn(),
          checkTentativeDisplacement: jest.fn(),
          reslotTentativePlayer: jest.fn(),
        },
      },
      {
        provide: SignupsRosterService,
        useValue: {
          cancel: jest.fn(),
          selfUnassign: jest.fn(),
          adminRemoveSignup: jest.fn(),
          updateRoster: jest.fn(),
        },
      },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      { provide: ActivityLogService, useValue: { log: jest.fn().mockResolvedValue(undefined), getTimeline: jest.fn().mockResolvedValue({ data: [] }) } },
    ],
  }).compile();
  service = module.get<SignupsService>(SignupsService);
}

// ─── signupDiscord tests ────────────────────────────────────────────────────

async function testAnonymousSignup() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    // ROK-626: getAssignedSlotRole (no assignment)
    .mockReturnValueOnce(makeSelectChain([]));
  const result = await service.signupDiscord(1, {
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
    discordAvatarHash: 'avatar-hash-abc',
  });
  expect(result.isAnonymous).toBe(true);
  expect(result.discordUserId).toBe('discord-anon-456');
  expect(mockDb.insert).toHaveBeenCalled();
}

async function testLinkedUserDelegates() {
  const signupSpy = jest.spyOn(service, 'signup').mockResolvedValueOnce({
    id: 11,
    eventId: 1,
    user: {
      id: 1,
      discordId: 'discord-user-123',
      username: 'linkeduser',
      avatar: null,
    },
    note: null,
    signedUpAt: new Date().toISOString(),
    characterId: null,
    character: null,
    confirmationStatus: 'pending',
    status: 'signed_up',
  });
  mockDb.select.mockReturnValueOnce(makeSelectChain([mockUser]));
  await service.signupDiscord(1, {
    discordUserId: 'discord-user-123',
    discordUsername: 'linkeduser',
  });
  expect(signupSpy).toHaveBeenCalledWith(1, mockUser.id, {
    preferredRoles: undefined,
    slotRole: undefined,
  });
}

async function testEventNotFound() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([]));
  await expect(
    service.signupDiscord(999, {
      discordUserId: 'discord-anon',
      discordUsername: 'AnonUser',
    }),
  ).rejects.toThrow(NotFoundException);
}

async function testDuplicateReturnsExisting() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    .mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]))
    // ROK-626: getAssignedSlotRole (duplicate path — signup exists)
    .mockReturnValueOnce(makeSelectChain([]));
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
      }),
    }),
  });
  const result = await service.signupDiscord(1, {
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
  });
  expect(result).toMatchObject({ id: expect.any(Number), isAnonymous: true });
}

async function testRosterAssignmentWithRole() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    .mockReturnValueOnce(makeSelectChainNoLimit([]))
    // ROK-626: getAssignedSlotRole
    .mockReturnValueOnce(makeSelectChain([{ role: 'dps' }]));
  mockDb.insert
    .mockReturnValueOnce({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
        }),
      }),
    })
    .mockReturnValueOnce({ values: jest.fn().mockResolvedValue(undefined) });
  await service.signupDiscord(1, {
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
    role: 'dps',
  });
  expect(mockDb.insert).toHaveBeenCalledTimes(2);
}

async function testTentativeStatus() {
  const tentativeSignup = { ...mockAnonymousSignup, status: 'tentative' };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    // ROK-626: getAssignedSlotRole
    .mockReturnValueOnce(makeSelectChain([]));
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([tentativeSignup]),
      }),
    }),
  });
  const result = await service.signupDiscord(1, {
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
    status: 'tentative',
  });
  expect(result.status).toBe('tentative');
}

// ─── ROK-451 auto-slot tests ────────────────────────────────────────────────

const genericEvent = {
  ...mockEvent,
  slotConfig: { type: 'generic', player: 4, bench: 2 },
};
const mmoEvent = {
  ...mockEvent,
  slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
};
const maxAttendeesEvent = { ...mockEvent, slotConfig: null, maxAttendees: 4 };

async function testAutoSlotGeneric() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([genericEvent]))
    // ROK-626: checkAutoBench (not full → normal allocation)
    .mockReturnValueOnce(makeSelectChain([{ count: 0 }]))
    .mockReturnValueOnce(makeSelectChainNoLimit([]))
    .mockReturnValueOnce(makeSelectChainNoLimit([]))
    // ROK-626: getAssignedSlotRole
    .mockReturnValueOnce(makeSelectChain([{ role: 'player' }]));
  mockDb.insert
    .mockReturnValueOnce({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
        }),
      }),
    })
    .mockReturnValueOnce({ values: jest.fn().mockResolvedValue(undefined) });
  await service.signupDiscord(1, {
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
  });
  expect(mockDb.insert).toHaveBeenCalledTimes(2);
}

async function testNoAutoSlotMmo() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([mmoEvent]))
    // ROK-626: checkAutoBench (not full → normal flow, no roles → no assignment)
    .mockReturnValueOnce(makeSelectChain([{ count: 0 }]))
    // ROK-626: getAssignedSlotRole
    .mockReturnValueOnce(makeSelectChain([]));
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
      }),
    }),
  });
  await service.signupDiscord(1, {
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
  });
  expect(mockDb.insert).toHaveBeenCalledTimes(1);
}

async function testAutoBenchWhenFull() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([genericEvent]))
    // ROK-626: checkAutoBench (full → auto-bench)
    .mockReturnValueOnce(makeSelectChain([{ count: 4 }]))
    // findNextPosition for bench slot
    .mockReturnValueOnce(makeSelectChainNoLimit([]))
    // ROK-626: getAssignedSlotRole
    .mockReturnValueOnce(makeSelectChain([{ role: 'bench' }]));
  mockDb.insert
    .mockReturnValueOnce({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
        }),
      }),
    })
    // bench roster assignment insert
    .mockReturnValueOnce({ values: jest.fn().mockResolvedValue(undefined) });
  const result = await service.signupDiscord(1, {
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
  });
  // ROK-626: 2 inserts — signup row + bench roster assignment
  expect(mockDb.insert).toHaveBeenCalledTimes(2);
  // ROK-626: response includes assignedSlot
  expect(result.assignedSlot).toBe('bench');
}

async function testAutoSlotMaxAttendees() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([maxAttendeesEvent]))
    // ROK-626: checkAutoBench (not full → normal allocation)
    .mockReturnValueOnce(makeSelectChain([{ count: 2 }]))
    .mockReturnValueOnce(
      makeSelectChainNoLimit([{ position: 1 }, { position: 2 }]),
    )
    .mockReturnValueOnce(
      makeSelectChainNoLimit([{ position: 1 }, { position: 2 }]),
    )
    // ROK-626: getAssignedSlotRole
    .mockReturnValueOnce(makeSelectChain([{ role: 'player' }]));
  mockDb.insert
    .mockReturnValueOnce({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
        }),
      }),
    })
    .mockReturnValueOnce({ values: jest.fn().mockResolvedValue(undefined) });
  await service.signupDiscord(1, {
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
  });
  expect(mockDb.insert).toHaveBeenCalledTimes(2);
}

async function testNoAutoSlotNoConfig() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    // ROK-626: getAssignedSlotRole
    .mockReturnValueOnce(makeSelectChain([]));
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
      }),
    }),
  });
  await service.signupDiscord(1, {
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
  });
  expect(mockDb.insert).toHaveBeenCalledTimes(1);
}

async function testExplicitRoleOverAutoSlot() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([genericEvent]))
    // ROK-626: checkAutoBench (not full → normal allocation)
    .mockReturnValueOnce(makeSelectChain([{ count: 0 }]))
    .mockReturnValueOnce(makeSelectChainNoLimit([]))
    // ROK-626: getAssignedSlotRole
    .mockReturnValueOnce(makeSelectChain([{ role: 'dps' }]));
  mockDb.insert
    .mockReturnValueOnce({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
        }),
      }),
    })
    .mockReturnValueOnce({ values: jest.fn().mockResolvedValue(undefined) });
  await service.signupDiscord(1, {
    discordUserId: 'discord-anon-456',
    discordUsername: 'AnonUser',
    role: 'dps',
  });
  expect(mockDb.insert).toHaveBeenCalledTimes(2);
}

beforeEach(() => setupEach());

describe('SignupsService — signupDiscord', () => {
  it('should create anonymous signup', () => testAnonymousSignup());
  it('should delegate to signup for linked user', () =>
    testLinkedUserDelegates());
  it('should throw NotFoundException when event missing', () =>
    testEventNotFound());
  it('should return existing on duplicate', () =>
    testDuplicateReturnsExisting());
  it('should create roster assignment with role', () =>
    testRosterAssignmentWithRole());
  it('should set tentative status', () => testTentativeStatus());
});

describe('SignupsService — signupDiscord auto-slot', () => {
  it('should auto-assign for generic event', () => testAutoSlotGeneric());
  it('should NOT auto-slot for MMO events', () => testNoAutoSlotMmo());
  it('should auto-bench when roster is full (ROK-626)', () =>
    testAutoBenchWhenFull());
  it('should auto-slot with maxAttendees', () => testAutoSlotMaxAttendees());
  it('should NOT auto-slot without config', () => testNoAutoSlotNoConfig());
  it('should prefer explicit role', () => testExplicitRoleOverAutoSlot());
});
