import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GameRegistryService } from './game-registry.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

// Mock database type to satisfy ESLint
type MockDb = {
  select: jest.Mock;
  from: jest.Mock;
  where: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
};

describe('GameRegistryService', () => {
  let service: GameRegistryService;
  let mockDb: MockDb;

  const mockGame = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    slug: 'wow',
    name: 'World of Warcraft',
    iconUrl: 'https://example.com/icon.png',
    colorHex: '#F58518',
    hasRoles: true,
    hasSpecs: true,
    maxCharactersPerUser: 10,
    createdAt: new Date('2026-01-01'),
  };

  const mockEventType = {
    id: '660e8400-e29b-41d4-a716-446655440001',
    gameId: mockGame.id,
    slug: 'mythic-raid',
    name: 'Mythic Raid',
    defaultPlayerCap: 20,
    defaultDurationMinutes: 180,
    requiresComposition: true,
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    const mockDbInstance: MockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    mockDb = mockDbInstance;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameRegistryService,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<GameRegistryService>(GameRegistryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all games with meta', async () => {
      mockDb.orderBy.mockResolvedValue([mockGame]);

      const result = await service.findAll();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].slug).toBe('wow');
      expect(result.meta.total).toBe(1);
    });

    it('should return empty array when no games exist', async () => {
      mockDb.orderBy.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('findOne', () => {
    it('should return game with event types', async () => {
      // First call returns game, second call returns event types
      mockDb.limit.mockResolvedValueOnce([mockGame]);
      mockDb.orderBy.mockResolvedValueOnce([mockEventType]);

      const result = await service.findOne(mockGame.id);

      expect(result.id).toBe(mockGame.id);
      expect(result.name).toBe('World of Warcraft');
      expect(result.eventTypes).toHaveLength(1);
      expect(result.eventTypes[0].name).toBe('Mythic Raid');
    });

    it('should throw NotFoundException when game not found', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getEventTypes', () => {
    it('should return event types for a game', async () => {
      mockDb.limit.mockResolvedValueOnce([mockGame]);
      mockDb.orderBy.mockResolvedValueOnce([mockEventType]);

      const result = await service.getEventTypes(mockGame.id);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].slug).toBe('mythic-raid');
      expect(result.meta.gameId).toBe(mockGame.id);
      expect(result.meta.gameName).toBe('World of Warcraft');
    });

    it('should throw NotFoundException when game not found', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      await expect(service.getEventTypes('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
