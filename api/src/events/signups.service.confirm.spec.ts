import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SignupsService } from './signups.service';
import {
  createSignupsTestModule,
  mockUser,
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

function makeJoinedSelectChain(resolved: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      leftJoin: jest.fn().mockReturnValue({
        leftJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(resolved),
          }),
        }),
      }),
    }),
  };
}

async function setupEach() {
  const setup = await createSignupsTestModule();
  service = setup.service;
  mockDb = setup.mockDb;
}

// ─── getRoster tests ────────────────────────────────────────────────────────

async function testRosterWithCharacter() {
  const signupWithChar = {
    ...mockSignup,
    characterId: mockCharacter.id,
    confirmationStatus: 'confirmed',
  };
  mockDb.select.mockReturnValueOnce(
    makeJoinedSelectChain([
      {
        event_signups: signupWithChar,
        users: mockUser,
        characters: mockCharacter,
      },
    ]),
  );
  const result = await service.getRoster(1);
  expect(result.eventId).toBe(1);
  expect(result.count).toBe(1);
  expect(result.signups[0].user.username).toBe('testuser');
  expect(result.signups[0].character?.name).toBe('Frostweaver');
  expect(result.signups[0].confirmationStatus).toBe('confirmed');
}

async function testRosterNullCharacter() {
  mockDb.select.mockReturnValueOnce(
    makeJoinedSelectChain([
      { event_signups: mockSignup, users: mockUser, characters: null },
    ]),
  );
  const result = await service.getRoster(1);
  expect(result.signups[0].character).toBeNull();
  expect(result.signups[0].confirmationStatus).toBe('pending');
}

async function testRosterNotFound() {
  mockDb.select
    .mockReturnValueOnce(makeJoinedSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([]));
  await expect(service.getRoster(999)).rejects.toThrow(NotFoundException);
}

// ─── confirmSignup tests ────────────────────────────────────────────────────

async function testConfirmWithCharacter() {
  const confirmedSignup = {
    ...mockSignup,
    characterId: mockCharacter.id,
    confirmationStatus: 'confirmed',
  };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockSignup]))
    .mockReturnValueOnce(makeSelectChain([mockCharacter]))
    .mockReturnValueOnce(makeSelectChain([mockUser]));
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([confirmedSignup]),
      }),
    }),
  });
  const result = await service.confirmSignup(1, 1, 1, {
    characterId: mockCharacter.id,
  });
  expect(result).toMatchObject({
    characterId: expect.any(String),
    confirmationStatus: 'confirmed',
  });
  expect(mockDb.update).toHaveBeenCalled();
}

async function testConfirmNotFound() {
  mockDb.select.mockReturnValueOnce(makeSelectChain([]));
  await expect(
    service.confirmSignup(1, 999, 1, { characterId: 'char-uuid' }),
  ).rejects.toThrow(NotFoundException);
}

async function testConfirmForbidden() {
  const otherUserSignup = { ...mockSignup, userId: 2 };
  mockDb.select.mockReturnValueOnce(makeSelectChain([otherUserSignup]));
  await expect(
    service.confirmSignup(1, 1, 1, { characterId: 'char-uuid' }),
  ).rejects.toThrow(ForbiddenException);
}

async function testConfirmBadCharacter() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockSignup]))
    .mockReturnValueOnce(makeSelectChain([]));
  await expect(
    service.confirmSignup(1, 1, 1, { characterId: 'invalid-char' }),
  ).rejects.toThrow(BadRequestException);
}

async function testConfirmChanged() {
  const alreadyConfirmed = {
    ...mockSignup,
    characterId: 'old-char-id',
    confirmationStatus: 'confirmed',
  };
  const changedSignup = {
    ...alreadyConfirmed,
    characterId: mockCharacter.id,
    confirmationStatus: 'changed',
  };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([alreadyConfirmed]))
    .mockReturnValueOnce(makeSelectChain([mockCharacter]))
    .mockReturnValueOnce(makeSelectChain([mockUser]));
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([changedSignup]),
      }),
    }),
  });
  const result = await service.confirmSignup(1, 1, 1, {
    characterId: mockCharacter.id,
  });
  expect(result.confirmationStatus).toBe('changed');
}

beforeEach(() => setupEach());

describe('SignupsService — getRoster', () => {
  it('should return roster with character data', () =>
    testRosterWithCharacter());
  it('should return null character for pending', () =>
    testRosterNullCharacter());
  it('should throw NotFoundException for missing event', () =>
    testRosterNotFound());
});

describe('SignupsService — confirmSignup', () => {
  it('should confirm with character', () => testConfirmWithCharacter());
  it('should throw NotFoundException when missing', () =>
    testConfirmNotFound());
  it('should throw ForbiddenException for wrong user', () =>
    testConfirmForbidden());
  it('should throw BadRequestException for invalid char', () =>
    testConfirmBadCharacter());
  it('should set status to changed on re-confirm', () => testConfirmChanged());
});
