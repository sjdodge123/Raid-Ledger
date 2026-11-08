/**
 * Unit tests for ROK-137 Discord signup methods — updateStatus, findByDiscordUser,
 * cancelByDiscordUser, claimAnonymousSignups.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';
import { SignupsAllocationService } from './signups-allocation.service';
import { SignupsRosterService } from './signups-roster.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

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
const mockLinkedSignup = {
  id: 11,
  eventId: 1,
  userId: 1,
  discordUserId: null,
  discordUsername: null,
  discordAvatarHash: null,
  note: null,
  signedUpAt: new Date(),
  characterId: null,
  confirmationStatus: 'pending',
  status: 'signed_up',
};

function makeSelectChain(resolvedValue: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

/**
 * Select chain whose `where` is a spy, so a spec can render the WHERE clause
 * the service built (ROK-2097: the Discord-id ownership predicate).
 */
function makeSpiedSelectChain(resolvedValue: unknown[]) {
  const where = jest.fn().mockReturnValue({
    limit: jest.fn().mockResolvedValue(resolvedValue),
  });
  return { chain: { from: jest.fn().mockReturnValue({ where }) }, where };
}

/** Renders the first WHERE clause a spied chain received. */
function renderWhere(where: jest.Mock): { sql: string; params: unknown[] } {
  const clause = (where.mock.calls[0] as [SQL] | undefined)?.[0];
  if (!clause) throw new Error('expected a WHERE clause, got none');
  return new PgDialect().sqlToQuery(clause);
}

function createMockDb() {
  const db: Record<
    'delete' | 'insert' | 'select' | 'transaction' | 'update',
    jest.Mock
  > = {
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
let mockDb: ReturnType<typeof createMockDb>;

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
          autoAllocateSignup: jest.fn().mockResolvedValue(undefined),
          promoteFromBench: jest.fn().mockResolvedValue(null),
          checkTentativeDisplacement: jest.fn().mockResolvedValue(undefined),
          reslotTentativePlayer: jest.fn().mockResolvedValue(undefined),
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
      {
        provide: ActivityLogService,
        useValue: {
          log: jest.fn().mockResolvedValue(undefined),
          getTimeline: jest.fn().mockResolvedValue({ data: [] }),
        },
      },
    ],
  }).compile();
  service = module.get<SignupsService>(SignupsService);
}

// ─── updateStatus tests ─────────────────────────────────────────────────────

async function testUpdateStatusAnonymous() {
  const updatedSignup = { ...mockAnonymousSignup, status: 'tentative' };
  // ROK-2097: the Discord id is linked to nobody → guest rows only.
  const signupQuery = makeSpiedSelectChain([mockAnonymousSignup]);
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(signupQuery.chain);
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([updatedSignup]),
      }),
    }),
  });
  const result = await service.updateStatus(
    1,
    { discordUserId: 'discord-anon-456' },
    { status: 'tentative' },
  );
  expect(result.status).toBe('tentative');
  expect(result.isAnonymous).toBe(true);
  const { sql, params } = renderWhere(signupQuery.where);
  expect(sql).toContain(
    '"event_signups"."discord_user_id" = $2 and "event_signups"."user_id" is null',
  );
  expect(params).toEqual([1, 'discord-anon-456']);
}

async function testUpdateStatusLinked() {
  const updatedLinked = { ...mockLinkedSignup, status: 'declined' };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockLinkedSignup]))
    .mockReturnValueOnce(makeSelectChain([mockUser]));
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([updatedLinked]),
      }),
    }),
  });
  const result = await service.updateStatus(
    1,
    { userId: 1 },
    { status: 'declined' },
  );
  expect(result.status).toBe('declined');
  expect(result.user.username).toBe('linkeduser');
}

async function testUpdateStatusNotFound() {
  mockDb.select.mockReturnValueOnce(makeSelectChain([]));
  await expect(
    service.updateStatus(1, { userId: 99 }, { status: 'tentative' }),
  ).rejects.toThrow(NotFoundException);
}

async function testUpdateStatusNoIdentifier() {
  await expect(
    service.updateStatus(1, {}, { status: 'tentative' }),
  ).rejects.toThrow(BadRequestException);
}

async function testUpdateStatusByDiscordId() {
  // ROK-2097: linked to RL user 1 → guest rows or user 1's own row only.
  const signupQuery = makeSpiedSelectChain([mockAnonymousSignup]);
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([{ id: 1 }]))
    .mockReturnValueOnce(signupQuery.chain);
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest
          .fn()
          .mockResolvedValue([{ ...mockAnonymousSignup, status: 'signed_up' }]),
      }),
    }),
  });
  const result = await service.updateStatus(
    1,
    { discordUserId: 'discord-anon-456' },
    { status: 'signed_up' },
  );
  expect(result.status).toBe('signed_up');
  const { sql, params } = renderWhere(signupQuery.where);
  expect(sql).toContain(
    '("event_signups"."user_id" is null or "event_signups"."user_id" = $3)',
  );
  expect(params).toEqual([1, 'discord-anon-456', 1]);
}

// ─── findByDiscordUser tests ────────────────────────────────────────────────

async function testFindLinkedUser() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockUser]))
    .mockReturnValueOnce(makeSelectChain([mockLinkedSignup]));
  const result = await service.findByDiscordUser(1, 'discord-user-123');
  expect(result).not.toBeNull();
  expect(result?.user.username).toBe('linkeduser');
}

async function testFindLinkedNoSignup() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockUser]))
    .mockReturnValueOnce(makeSelectChain([]));
  expect(await service.findByDiscordUser(1, 'discord-user-123')).toBeNull();
}

async function testFindAnonymous() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]));
  const result = await service.findByDiscordUser(1, 'discord-anon-456');
  expect(result).not.toBeNull();
  expect(result?.isAnonymous).toBe(true);
  expect(result?.discordUserId).toBe('discord-anon-456');
}

async function testFindNoSignupAnonymous() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([]));
  expect(await service.findByDiscordUser(1, 'unknown-discord-id')).toBeNull();
}

async function testFindWithCharacter() {
  const mockCharacter = {
    id: 'char-uuid-1',
    name: 'Frostweaver',
    class: 'Mage',
    spec: 'Arcane',
    role: 'dps',
    roleOverride: null,
    isMain: true,
    itemLevel: 485,
    level: 60,
    avatarUrl: null,
    race: 'Human',
    faction: 'alliance',
  };
  const signupWithChar = { ...mockLinkedSignup, characterId: 'char-uuid-1' };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([mockUser]))
    .mockReturnValueOnce(makeSelectChain([signupWithChar]))
    .mockReturnValueOnce(makeSelectChain([mockCharacter]));
  const result = await service.findByDiscordUser(1, 'discord-user-123');
  expect(result?.characterId).toBe('char-uuid-1');
  expect(result?.character?.name).toBe('Frostweaver');
}

// ─── cancelByDiscordUser tests ──────────────────────────────────────────────

async function testCancelAnonymous() {
  const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]))
    .mockReturnValueOnce(
      makeSelectChain([
        {
          duration: [
            futureStart,
            new Date(futureStart.getTime() + 2 * 60 * 60 * 1000),
          ],
        },
      ]),
    );
  await service.cancelByDiscordUser(1, 'discord-anon-456');
  expect(mockDb.delete).toHaveBeenCalled();
}

async function testCancelDelegatesToLinked() {
  const cancelSpy = jest
    .spyOn(service, 'cancel')
    .mockResolvedValueOnce(undefined);
  mockDb.select.mockReturnValueOnce(makeSelectChain([mockUser]));
  await service.cancelByDiscordUser(1, 'discord-user-123');
  expect(cancelSpy).toHaveBeenCalledWith(1, mockUser.id);
  expect(mockDb.delete).not.toHaveBeenCalled();
}

async function testCancelNotFound() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([]))
    .mockReturnValueOnce(makeSelectChain([]));
  await expect(
    service.cancelByDiscordUser(1, 'unknown-discord-id'),
  ).rejects.toThrow(NotFoundException);
}

// ─── claimAnonymousSignups tests ────────────────────────────────────────────

async function testClaimMultiple() {
  const claimed = [
    { ...mockAnonymousSignup, userId: 1 },
    { ...mockAnonymousSignup, id: 11, userId: 1 },
  ];
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue(claimed),
      }),
    }),
  });
  const count = await service.claimAnonymousSignups('discord-anon-456', 1);
  expect(count).toBe(2);
}

async function testClaimNone() {
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([]),
      }),
    }),
  });
  expect(await service.claimAnonymousSignups('unknown-discord-id', 99)).toBe(0);
}

async function testClaimOnlyNull() {
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest
          .fn()
          .mockResolvedValue([{ ...mockAnonymousSignup, userId: 5 }]),
      }),
    }),
  });
  const count = await service.claimAnonymousSignups('discord-anon-456', 5);
  expect(count).toBe(1);
  expect(mockDb.update).toHaveBeenCalledTimes(1);
}

beforeEach(() => setupEach());

describe('SignupsService — updateStatus', () => {
  it('should update anonymous to tentative', () => testUpdateStatusAnonymous());
  it('should update linked user status', () => testUpdateStatusLinked());
  it('should throw NotFoundException when missing', () =>
    testUpdateStatusNotFound());
  it('should throw BadRequestException without identifier', () =>
    testUpdateStatusNoIdentifier());
  it('should update by discordUserId', () => testUpdateStatusByDiscordId());
});

describe('SignupsService — findByDiscordUser', () => {
  it('should return linked user signup', () => testFindLinkedUser());
  it('should return null when linked has no signup', () =>
    testFindLinkedNoSignup());
  it('should return anonymous signup', () => testFindAnonymous());
  it('should return null when no signup', () => testFindNoSignupAnonymous());
  it('should include character data', () => testFindWithCharacter());
});

describe('SignupsService — cancelByDiscordUser', () => {
  it('should cancel anonymous signup', () => testCancelAnonymous());
  it('should delegate to cancel for linked', () =>
    testCancelDelegatesToLinked());
  it('should throw NotFoundException when missing', () => testCancelNotFound());
});

describe('SignupsService — claimAnonymousSignups', () => {
  it('should claim multiple signups', () => testClaimMultiple());
  it('should return 0 when none exist', () => testClaimNone());
  it('should only claim null userId', () => testClaimOnlyNull());
});
