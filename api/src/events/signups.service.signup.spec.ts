import { NotFoundException } from '@nestjs/common';
import { SignupsService } from './signups.service';
import {
  createSignupsTestModule,
  mockUser,
  mockEvent,
  mockSignup,
  mockCharacter,
} from './signups.spec-helpers';

let service: SignupsService;
let mockDb: Record<string, jest.Mock>;

function makeSelectChain(resolved: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(resolved),
      }),
    }),
  };
}

function makeSelectChainNoLimit(resolved: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(resolved),
    }),
  };
}

async function setupEach() {
  const setup = await createSignupsTestModule();
  service = setup.service;
  mockDb = setup.mockDb;
}

// ─── signup tests ───────────────────────────────────────────────────────────

async function testCreateSignup() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([mockUser]));
  const result = await service.signup(1, 1);
  expect(result.eventId).toBe(1);
  expect(result.confirmationStatus).toBe('pending');
  expect(mockDb.insert).toHaveBeenCalled();
}

async function testSignupNotFound() {
  mockDb.select.mockReturnValueOnce(makeSelectChain([]));
  await expect(service.signup(999, 1)).rejects.toThrow(NotFoundException);
}

async function testDuplicateReturnsExisting() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    .mockReturnValueOnce(makeSelectChain([mockUser]))
    .mockReturnValueOnce(makeSelectChain([mockSignup]))
    .mockReturnValueOnce(makeSelectChain([{ id: 1 }]));
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
      }),
    }),
  });
  const result = await service.signup(1, 1);
  expect(result).toMatchObject({ id: expect.any(Number), eventId: 1 });
}

async function testConcurrentDuplicate() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    .mockReturnValueOnce(makeSelectChain([mockUser]))
    .mockReturnValueOnce(makeSelectChain([mockSignup]))
    .mockReturnValueOnce(makeSelectChain([{ id: 1 }]));
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
      }),
    }),
  });
  const result = await service.signup(1, 1);
  expect(result).toMatchObject({
    id: expect.any(Number),
    confirmationStatus: 'pending',
  });
}

async function testDuplicateFullData() {
  const existing = {
    ...mockSignup,
    note: 'Bringing healer',
    confirmationStatus: 'confirmed',
    characterId: null,
  };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    .mockReturnValueOnce(makeSelectChain([mockUser]))
    .mockReturnValueOnce(makeSelectChain([existing]))
    .mockReturnValueOnce(makeSelectChain([{ id: 1 }]));
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
      }),
    }),
  });
  const result = await service.signup(1, 1);
  expect(result).toMatchObject({
    id: expect.any(Number),
    eventId: 1,
    note: 'Bringing healer',
    confirmationStatus: 'confirmed',
    user: { username: 'testuser', id: 1 },
  });
  expect(result.character).toBeNull();
}

async function testDuplicateWithCharacter() {
  const existing = {
    ...mockSignup,
    characterId: mockCharacter.id,
    confirmationStatus: 'confirmed',
  };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    .mockReturnValueOnce(makeSelectChain([mockUser]))
    .mockReturnValueOnce(makeSelectChain([existing]))
    .mockReturnValueOnce(makeSelectChain([{ id: 1 }]))
    .mockReturnValueOnce(makeSelectChain([mockCharacter]));
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
      }),
    }),
  });
  const result = await service.signup(1, 1);
  expect(result).toMatchObject({
    characterId: expect.any(String),
    character: { name: 'Frostweaver', role: 'dps' },
  });
}

async function testDuplicateRowDisappeared() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    .mockReturnValueOnce(makeSelectChain([mockUser]))
    .mockReturnValueOnce(makeSelectChain([]));
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
      }),
    }),
  });
  await expect(service.signup(1, 1)).rejects.toThrow();
}

async function testOnConflictDoNothing() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockEvent]))
    .mockReturnValueOnce(makeSelectChain([mockUser]));
  const onConflictMock = jest.fn().mockReturnValue({
    returning: jest.fn().mockResolvedValue([mockSignup]),
  });
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: onConflictMock,
      returning: jest.fn().mockResolvedValue([mockSignup]),
    }),
  });
  await service.signup(1, 1);
  expect(onConflictMock).toHaveBeenCalled();
}

async function testSignupWithSlotRole() {
  const signupWithSlot = { ...mockSignup, id: 5 };
  const onConflictMock = jest.fn().mockReturnValue({
    returning: jest.fn().mockResolvedValue([signupWithSlot]),
  });
  mockDb.select
    .mockReturnValueOnce(
      makeSelectChain([{ ...mockEvent, maxAttendees: null }]),
    )
    .mockReturnValueOnce(makeSelectChain([mockUser]))
    .mockReturnValueOnce(makeSelectChainNoLimit([]));
  mockDb.insert
    .mockReturnValueOnce({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: onConflictMock,
        returning: jest.fn().mockResolvedValue([signupWithSlot]),
      }),
    })
    .mockReturnValueOnce({
      values: jest.fn().mockResolvedValue(undefined),
    });
  const result = await service.signup(1, 1, { slotRole: 'dps' });
  expect(result.id).toBe(signupWithSlot.id);
  expect(result.confirmationStatus).toBe('confirmed');
  expect(mockDb.insert).toHaveBeenCalledTimes(2);
  expect(onConflictMock).toHaveBeenCalled();
}

beforeEach(() => setupEach());

describe('SignupsService — signup', () => {
  it('should create signup when event exists', () => testCreateSignup());
  it('should throw NotFoundException when missing', () => testSignupNotFound());
  it('should return existing on duplicate', () =>
    testDuplicateReturnsExisting());
  it('should handle concurrent duplicates', () => testConcurrentDuplicate());
  it('should return full data on duplicate', () => testDuplicateFullData());
  it('should fetch character on duplicate with characterId', () =>
    testDuplicateWithCharacter());
  it('should throw when row disappears', () => testDuplicateRowDisappeared());
  it('should use onConflictDoNothing', () => testOnConflictDoNothing());
  it('should create signup with slotRole', () => testSignupWithSlotRole());
});
