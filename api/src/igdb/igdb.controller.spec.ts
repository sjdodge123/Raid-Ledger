import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { IgdbController } from './igdb.controller';
import { IgdbService } from './igdb.service';

describe('IgdbController', () => {
  let controller: IgdbController;
  let mockIgdbService: Partial<IgdbService>;

  const mockGames = [
    {
      id: 1,
      igdbId: 1234,
      name: 'Valheim',
      slug: 'valheim',
      coverUrl: 'https://example.com/cover.jpg',
    },
  ];

  beforeEach(async () => {
    mockIgdbService = {
      searchGames: jest
        .fn()
        .mockResolvedValue({ games: mockGames, cached: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IgdbController],
      providers: [{ provide: IgdbService, useValue: mockIgdbService }],
    }).compile();

    controller = module.get<IgdbController>(IgdbController);
  });


  describe('searchGames', () => {
    it('should return search results for valid query', async () => {
      const result = await controller.searchGames('valheim');

      expect(result.data).toEqual(mockGames);
      expect(result.meta.total).toBe(1);
      expect(result.meta.cached).toBe(true);
      expect(mockIgdbService.searchGames).toHaveBeenCalledWith('valheim');
    });

    it('should throw BadRequestException for empty query', async () => {
      await expect(controller.searchGames('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for undefined query', async () => {
      await expect(
        controller.searchGames(undefined as unknown as string),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for query exceeding max length', async () => {
      const longQuery = 'a'.repeat(101);
      await expect(controller.searchGames(longQuery)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw InternalServerErrorException for IGDB API errors', async () => {
      mockIgdbService.searchGames = jest
        .fn()
        .mockRejectedValue(new Error('IGDB API error: Unauthorized'));

      await expect(controller.searchGames('valheim')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should re-throw unexpected errors', async () => {
      const unexpectedError = new Error('Unexpected database error');
      mockIgdbService.searchGames = jest
        .fn()
        .mockRejectedValue(unexpectedError);

      await expect(controller.searchGames('valheim')).rejects.toThrow(
        unexpectedError,
      );
    });
  });
});
