/**
 * Unit tests for ROK-137 Discord signup methods — updateStatus, findByDiscordUser,
 * cancelByDiscordUser, claimAnonymousSignups.
 */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SignupsService } from './signups.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
import { BenchPromotionService } from './bench-promotion.service';

const mockEvent = {
  id: 1, title: 'Raid Night', creatorId: 5,
  maxAttendees: null, slotConfig: null, gameId: null,
};
const mockUser = {
  id: 1, username: 'linkeduser', avatar: 'avatar.png',
  discordId: 'discord-user-123', role: 'member',
  displayName: null, customAvatarUrl: null,
};
const mockAnonymousSignup = {
  id: 10, eventId: 1, userId: null,
  discordUserId: 'discord-anon-456', discordUsername: 'AnonUser',
  discordAvatarHash: 'avatar-hash-abc', note: null,
  signedUpAt: new Date(), characterId: null,
  confirmationStatus: 'confirmed', status: 'signed_up',
};
const mockLinkedSignup = {
  id: 11, eventId: 1, userId: 1,
  discordUserId: null, discordUsername: null,
  discordAvatarHash: null, note: null,
  signedUpAt: new Date(), characterId: null,
  confirmationStatus: 'pending', status: 'signed_up',
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

function createMockDb() {
  const mockDb: Record<string, jest.Mock> = {
    select: jest.fn(), insert: jest.fn(),
    delete: jest.fn(), update: jest.fn(), transaction: jest.fn(),
  };
  const insertChain = {
    values: jest.fn().mockReturnValue({
      onConflictDoNothing: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
      }),
      returning: jest.fn().mockResolvedValue([mockAnonymousSignup]),
    }),
  };
  mockDb.insert.mockReturnValue(insertChain);
  const deleteChain = { where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([]) }) };
  mockDb.delete.mockReturnValue(deleteChain);
  const updateChain = {
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([mockAnonymousSignup]) }),
    }),
  };
  mockDb.update.mockReturnValue(updateChain);
  mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb));
  return mockDb;
}

describe('SignupsService — Discord queries & status', () => {
  let service: SignupsService;
  let mockDb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockDb = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignupsService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue(null) } },
        { provide: RosterNotificationBufferService, useValue: { bufferLeave: jest.fn(), bufferJoin: jest.fn() } },
        { provide: BenchPromotionService, useValue: { schedulePromotion: jest.fn(), cancelPromotion: jest.fn(), isEligible: jest.fn().mockResolvedValue(false) } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get<SignupsService>(SignupsService);
  });

  describe('updateStatus', () => {
    it('should update status to tentative for anonymous Discord user', async () => {
      const updatedSignup = { ...mockAnonymousSignup, status: 'tentative' };
      mockDb.select.mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]));
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([updatedSignup]) }),
        }),
      });
      const result = await service.updateStatus(1, { discordUserId: 'discord-anon-456' }, { status: 'tentative' });
      expect(result.status).toBe('tentative');
      expect(result.isAnonymous).toBe(true);
    });

    it('should update status for linked RL user and return user info', async () => {
      const updatedLinkedSignup = { ...mockLinkedSignup, status: 'declined' };
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([mockLinkedSignup]))
        .mockReturnValueOnce(makeSelectChain([mockUser]));
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([updatedLinkedSignup]) }),
        }),
      });
      const result = await service.updateStatus(1, { userId: 1 }, { status: 'declined' });
      expect(result.status).toBe('declined');
      expect(result.user.username).toBe('linkeduser');
    });

    it('should throw NotFoundException when signup is not found', async () => {
      mockDb.select.mockReturnValueOnce(makeSelectChain([]));
      await expect(service.updateStatus(1, { userId: 99 }, { status: 'tentative' })).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when neither userId nor discordUserId provided', async () => {
      await expect(service.updateStatus(1, {}, { status: 'tentative' })).rejects.toThrow(BadRequestException);
    });

    it('should update status by discordUserId when user identifier is discord', async () => {
      mockDb.select.mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]));
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ ...mockAnonymousSignup, status: 'signed_up' }]) }),
        }),
      });
      const result = await service.updateStatus(1, { discordUserId: 'discord-anon-456' }, { status: 'signed_up' });
      expect(result.status).toBe('signed_up');
    });
  });

  describe('findByDiscordUser', () => {
    it('should return linked user signup when Discord user has RL account', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([mockUser]))
        .mockReturnValueOnce(makeSelectChain([mockLinkedSignup]));
      const result = await service.findByDiscordUser(1, 'discord-user-123');
      expect(result).not.toBeNull();
      expect(result?.user.username).toBe('linkeduser');
    });

    it('should return null when linked user has no signup for the event', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([mockUser]))
        .mockReturnValueOnce(makeSelectChain([]));
      const result = await service.findByDiscordUser(1, 'discord-user-123');
      expect(result).toBeNull();
    });

    it('should return anonymous signup when Discord user has no RL account', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]));
      const result = await service.findByDiscordUser(1, 'discord-anon-456');
      expect(result).not.toBeNull();
      expect(result?.isAnonymous).toBe(true);
      expect(result?.discordUserId).toBe('discord-anon-456');
    });

    it('should return null when no signup exists for anonymous user', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce(makeSelectChain([]));
      const result = await service.findByDiscordUser(1, 'unknown-discord-id');
      expect(result).toBeNull();
    });

    it('should include character data in linked user signup when character exists', async () => {
      const mockCharacter = {
        id: 'char-uuid-1', name: 'Frostweaver', class: 'Mage', spec: 'Arcane',
        role: 'dps', roleOverride: null, isMain: true, itemLevel: 485,
        level: 60, avatarUrl: null, race: 'Human', faction: 'alliance',
      };
      const signupWithChar = { ...mockLinkedSignup, characterId: 'char-uuid-1' };
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([mockUser]))
        .mockReturnValueOnce(makeSelectChain([signupWithChar]))
        .mockReturnValueOnce(makeSelectChain([mockCharacter]));
      const result = await service.findByDiscordUser(1, 'discord-user-123');
      expect(result?.characterId).toBe('char-uuid-1');
      expect(result?.character?.name).toBe('Frostweaver');
    });
  });

  describe('cancelByDiscordUser', () => {
    it('should cancel anonymous signup by discordUserId', async () => {
      const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce(makeSelectChain([mockAnonymousSignup]))
        .mockReturnValueOnce(makeSelectChain([{ duration: [futureStart, new Date(futureStart.getTime() + 2 * 60 * 60 * 1000)] }]));
      await service.cancelByDiscordUser(1, 'discord-anon-456');
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should delegate to cancel() when Discord user has a linked RL account', async () => {
      const cancelSpy = jest.spyOn(service, 'cancel').mockResolvedValueOnce(undefined);
      mockDb.select.mockReturnValueOnce(makeSelectChain([mockUser]));
      await service.cancelByDiscordUser(1, 'discord-user-123');
      expect(cancelSpy).toHaveBeenCalledWith(1, mockUser.id);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when no anonymous signup found', async () => {
      mockDb.select
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce(makeSelectChain([]));
      await expect(service.cancelByDiscordUser(1, 'unknown-discord-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('claimAnonymousSignups', () => {
    it('should update userId on anonymous signups matching discordUserId', async () => {
      const claimed = [
        { ...mockAnonymousSignup, userId: 1 },
        { ...mockAnonymousSignup, id: 11, userId: 1 },
      ];
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue(claimed) }),
        }),
      });
      const count = await service.claimAnonymousSignups('discord-anon-456', 1);
      expect(count).toBe(2);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should return 0 when no anonymous signups exist for Discord user', async () => {
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([]) }),
        }),
      });
      const count = await service.claimAnonymousSignups('unknown-discord-id', 99);
      expect(count).toBe(0);
    });

    it('should only claim signups with null userId (not already-claimed)', async () => {
      mockDb.update.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ ...mockAnonymousSignup, userId: 5 }]) }),
        }),
      });
      const count = await service.claimAnonymousSignups('discord-anon-456', 5);
      expect(count).toBe(1);
      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });
  });
});
