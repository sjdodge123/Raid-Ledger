import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GameRegistryController } from './game-registry.controller';
import { GameRegistryService } from './game-registry.service';

describe('GameRegistryController', () => {
  let controller: GameRegistryController;
  let mockService: Partial<GameRegistryService>;

  const mockGamesResponse = {
    data: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        slug: 'wow',
        name: 'World of Warcraft',
        iconUrl: 'https://example.com/icon.png',
        colorHex: '#F58518',
        hasRoles: true,
        hasSpecs: true,
        maxCharactersPerUser: 10,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    meta: { total: 1 },
  };

  const mockGameDetailResponse = {
    ...mockGamesResponse.data[0],
    eventTypes: [
      {
        id: '660e8400-e29b-41d4-a716-446655440001',
        gameId: '550e8400-e29b-41d4-a716-446655440000',
        slug: 'mythic-raid',
        name: 'Mythic Raid',
        defaultPlayerCap: 20,
        defaultDurationMinutes: 180,
        requiresComposition: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };

  const mockEventTypesResponse = {
    data: mockGameDetailResponse.eventTypes,
    meta: {
      total: 1,
      gameId: '550e8400-e29b-41d4-a716-446655440000',
      gameName: 'World of Warcraft',
    },
  };

  beforeEach(async () => {
    mockService = {
      findAll: jest.fn().mockResolvedValue(mockGamesResponse),
      findOne: jest.fn().mockResolvedValue(mockGameDetailResponse),
      getEventTypes: jest.fn().mockResolvedValue(mockEventTypesResponse),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GameRegistryController],
      providers: [
        {
          provide: GameRegistryService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<GameRegistryController>(GameRegistryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /game-registry', () => {
    it('should return all games', async () => {
      const result = await controller.findAll();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('World of Warcraft');
      expect(mockService.findAll).toHaveBeenCalled();
    });
  });

  describe('GET /game-registry/:id', () => {
    it('should return game with event types', async () => {
      const result = await controller.findOne(
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(result.name).toBe('World of Warcraft');
      expect(result.eventTypes).toHaveLength(1);
      expect(mockService.findOne).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
      );
    });

    it('should propagate NotFoundException', async () => {
      (mockService.findOne as jest.Mock).mockRejectedValue(
        new NotFoundException('Game not found'),
      );

      await expect(controller.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('GET /game-registry/:id/event-types', () => {
    it('should return event types for game', async () => {
      const result = await controller.getEventTypes(
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Mythic Raid');
      expect(result.meta.gameName).toBe('World of Warcraft');
      expect(mockService.getEventTypes).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
      );
    });
  });
});
