import { Test, TestingModule } from '@nestjs/testing';
import { QuestProgressController } from './quest-progress.controller';
import { QuestProgressService } from './quest-progress.service';
import { Reflector } from '@nestjs/core';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';

describe('QuestProgressController', () => {
  let controller: QuestProgressController;
  let mockService: {
    getProgressForEvent: jest.Mock;
    getCoverageForEvent: jest.Mock;
    updateProgress: jest.Mock;
  };

  const mockProgress = [
    {
      id: 1,
      eventId: 10,
      userId: 1,
      username: 'Roknua',
      questId: 2040,
      pickedUp: true,
      completed: false,
    },
  ];

  const mockCoverage = [
    {
      questId: 2040,
      coveredBy: [{ userId: 1, username: 'Roknua' }],
    },
  ];

  beforeEach(async () => {
    mockService = {
      getProgressForEvent: jest.fn().mockResolvedValue(mockProgress),
      getCoverageForEvent: jest.fn().mockResolvedValue(mockCoverage),
      updateProgress: jest.fn().mockResolvedValue(mockProgress[0]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuestProgressController],
      providers: [
        { provide: QuestProgressService, useValue: mockService },
        { provide: Reflector, useValue: new Reflector() },
        {
          provide: PluginRegistryService,
          useValue: {
            getActiveSlugsSync: jest
              .fn()
              .mockReturnValue(new Set(['blizzard'])),
          },
        },
      ],
    }).compile();

    controller = module.get<QuestProgressController>(QuestProgressController);
  });

  describe('getProgressForEvent()', () => {
    it('should return all progress for an event', async () => {
      const result = await controller.getProgressForEvent(10);

      expect(result).toEqual(mockProgress);
      expect(mockService.getProgressForEvent).toHaveBeenCalledWith(10);
    });
  });

  describe('getCoverageForEvent()', () => {
    it('should return quest coverage', async () => {
      const result = await controller.getCoverageForEvent(10);

      expect(result).toEqual(mockCoverage);
      expect(mockService.getCoverageForEvent).toHaveBeenCalledWith(10);
    });
  });

  describe('updateProgress()', () => {
    it('should update progress for the current user', async () => {
      const body = { questId: 2040, pickedUp: true };
      const req = { user: { id: 1 } };

      const result = await controller.updateProgress(10, body, req);

      expect(result).toEqual(mockProgress[0]);
      expect(mockService.updateProgress).toHaveBeenCalledWith(10, 1, 2040, {
        pickedUp: true,
        completed: undefined,
      });
    });

    it('should pass completed flag through', async () => {
      const body = { questId: 3001, completed: true };
      const req = { user: { id: 2 } };

      await controller.updateProgress(10, body, req);

      expect(mockService.updateProgress).toHaveBeenCalledWith(10, 2, 3001, {
        pickedUp: undefined,
        completed: true,
      });
    });
  });
});
