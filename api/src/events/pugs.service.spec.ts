/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PugsService } from './pugs.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PUG_SLOT_EVENTS } from '../discord-bot/discord-bot.constants';

describe('PugsService', () => {
  let module: TestingModule;
  let service: PugsService;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let mockDb: {
    insert: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  const createChainMock = (resolvedValue: unknown[] = []) => {
    const chain: Record<string, jest.Mock> = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(resolvedValue);
    chain.set = jest.fn().mockReturnValue(chain);
    chain.values = jest.fn().mockReturnValue(chain);
    chain.returning = jest.fn().mockResolvedValue(resolvedValue);
    chain.orderBy = jest.fn().mockResolvedValue(resolvedValue);
    return chain;
  };

  const mockEvent = {
    id: 42,
    title: 'Test Raid',
    creatorId: 1,
    cancelledAt: null,
  };

  const mockInsertedPugSlot = {
    id: 'pug-uuid-123',
    eventId: 42,
    discordUsername: 'testplayer',
    discordUserId: null,
    discordAvatarHash: null,
    role: 'dps',
    class: null,
    spec: null,
    notes: null,
    status: 'pending',
    serverInviteUrl: null,
    claimedByUserId: null,
    createdBy: 1,
    createdAt: new Date('2026-02-19T00:00:00Z'),
    updatedAt: new Date('2026-02-19T00:00:00Z'),
  };

  beforeEach(async () => {
    mockDb = {
      insert: jest.fn().mockReturnValue(createChainMock([mockInsertedPugSlot])),
      select: jest.fn().mockReturnValue(createChainMock([mockEvent])),
      update: jest.fn().mockReturnValue(createChainMock()),
      delete: jest.fn().mockReturnValue(createChainMock()),
    };

    module = await Test.createTestingModule({
      providers: [
        PugsService,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(PugsService);
    eventEmitter = module.get(EventEmitter2);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
  });

  describe('create', () => {
    it('should emit PUG_SLOT_EVENTS.CREATED after successful creation', async () => {
      await service.create(42, 1, false, {
        discordUsername: 'testplayer',
        role: 'dps',
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        PUG_SLOT_EVENTS.CREATED,
        expect.objectContaining({
          pugSlotId: 'pug-uuid-123',
          eventId: 42,
          discordUsername: 'testplayer',
        }),
      );
    });

    it('should emit with the correct event name string', async () => {
      await service.create(42, 1, false, {
        discordUsername: 'testplayer',
        role: 'tank',
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'pug-slot.created',
        expect.anything(),
      );
    });

    it('should not emit event when creation fails', async () => {
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest
            .fn()
            .mockRejectedValue(
              Object.assign(new Error('unique_event_pug'), {}),
            ),
        }),
      });

      await expect(
        service.create(42, 1, false, {
          discordUsername: 'testplayer',
          role: 'dps',
        }),
      ).rejects.toThrow();

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should return valid PugSlotResponseDto', async () => {
      const result = await service.create(42, 1, false, {
        discordUsername: 'testplayer',
        role: 'dps',
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 'pug-uuid-123',
          eventId: 42,
          discordUsername: 'testplayer',
          role: 'dps',
          status: 'pending',
        }),
      );
    });
  });
});
