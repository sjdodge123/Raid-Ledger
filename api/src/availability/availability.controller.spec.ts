import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

describe('AvailabilityController', () => {
  let controller: AvailabilityController;
  let mockService: Partial<AvailabilityService>;

  const mockAvailabilityDto = {
    id: 'avail-uuid-1',
    userId: 1,
    timeRange: {
      start: '2026-02-05T18:00:00.000Z',
      end: '2026-02-05T22:00:00.000Z',
    },
    status: 'available' as const,
    gameId: null,
    sourceEventId: null,
    createdAt: '2026-02-04T12:00:00.000Z',
    updatedAt: '2026-02-04T12:00:00.000Z',
  };

  const mockRequest = {
    user: { id: 1, discordId: 'discord-123' },
  };

  beforeEach(async () => {
    mockService = {
      findAllForUser: jest.fn().mockResolvedValue({
        data: [mockAvailabilityDto],
        meta: { total: 1 },
      }),
      findOne: jest.fn().mockResolvedValue(mockAvailabilityDto),
      create: jest.fn().mockResolvedValue(mockAvailabilityDto),
      update: jest.fn().mockResolvedValue(mockAvailabilityDto),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AvailabilityController],
      providers: [{ provide: AvailabilityService, useValue: mockService }],
    }).compile();

    controller = module.get<AvailabilityController>(AvailabilityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return user availability list', async () => {
      const result = await controller.findAll(mockRequest as never, {});

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(mockService.findAllForUser).toHaveBeenCalledWith(1, {});
    });

    it('should pass query filters to service', async () => {
      await controller.findAll(mockRequest as never, {
        from: '2026-02-05T00:00:00Z',
        to: '2026-02-06T00:00:00Z',
      });

      expect(mockService.findAllForUser).toHaveBeenCalledWith(1, {
        from: '2026-02-05T00:00:00Z',
        to: '2026-02-06T00:00:00Z',
      });
    });
  });

  describe('findOne', () => {
    it('should return a single availability window', async () => {
      const result = await controller.findOne(
        mockRequest as never,
        'avail-uuid-1',
      );

      expect(result.id).toBe('avail-uuid-1');
      expect(mockService.findOne).toHaveBeenCalledWith(1, 'avail-uuid-1');
    });
  });

  describe('create', () => {
    it('should create a new availability window', async () => {
      const createDto = {
        startTime: '2026-02-05T18:00:00.000Z',
        endTime: '2026-02-05T22:00:00.000Z',
        status: 'available',
      };

      const result = await controller.create(mockRequest as never, createDto);

      expect(result.id).toBe('avail-uuid-1');
      expect(mockService.create).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          startTime: createDto.startTime,
          endTime: createDto.endTime,
        }),
      );
    });

    it('should throw BadRequestException for invalid input', async () => {
      const invalidDto = {
        startTime: 'invalid-date',
        endTime: '2026-02-05T22:00:00.000Z',
      };

      await expect(
        controller.create(mockRequest as never, invalidDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should update an availability window', async () => {
      const updateDto = { status: 'blocked' };

      const result = await controller.update(
        mockRequest as never,
        'avail-uuid-1',
        updateDto,
      );

      expect(result.id).toBe('avail-uuid-1');
      expect(mockService.update).toHaveBeenCalledWith(
        1,
        'avail-uuid-1',
        expect.objectContaining({ status: 'blocked' }),
      );
    });
  });

  describe('delete', () => {
    it('should delete an availability window', async () => {
      const result = await controller.delete(
        mockRequest as never,
        'avail-uuid-1',
      );

      expect(result).toEqual({ success: true });
      expect(mockService.delete).toHaveBeenCalledWith(1, 'avail-uuid-1');
    });
  });
});
