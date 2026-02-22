import { Test, TestingModule } from '@nestjs/testing';
import { DungeonQuestsController } from './dungeon-quests.controller';
import { DungeonQuestsService } from './dungeon-quests.service';
import { Reflector } from '@nestjs/core';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';

describe('DungeonQuestsController', () => {
  let controller: DungeonQuestsController;
  let mockService: {
    getQuestsForInstance: jest.Mock;
    getQuestChain: jest.Mock;
  };

  const mockQuests = [
    {
      questId: 2040,
      dungeonInstanceId: 63,
      name: 'The Defias Brotherhood',
      questLevel: 18,
      requiredLevel: 14,
      expansion: 'classic',
      questGiverNpc: 'Gryan Stoutmantle',
      questGiverZone: 'Kalimdor',
      prevQuestId: 166,
      nextQuestId: null,
      rewardsJson: [2041],
      objectives:
        'Kill Edwin VanCleef and bring his head to Gryan Stoutmantle.',
      classRestriction: null,
      raceRestriction: ['Human', 'Dwarf', 'Night Elf', 'Gnome'],
      startsInsideDungeon: false,
      sharable: true,
    },
  ];

  beforeEach(async () => {
    mockService = {
      getQuestsForInstance: jest.fn().mockResolvedValue(mockQuests),
      getQuestChain: jest.fn().mockResolvedValue(mockQuests),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DungeonQuestsController],
      providers: [
        { provide: DungeonQuestsService, useValue: mockService },
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

    controller = module.get<DungeonQuestsController>(DungeonQuestsController);
  });

  describe('getQuestsForInstance()', () => {
    it('should return quests for a dungeon instance', async () => {
      const result = await controller.getQuestsForInstance(63, 'classic_era');

      expect(result).toEqual(mockQuests);
      expect(mockService.getQuestsForInstance).toHaveBeenCalledWith(
        63,
        'classic_era',
      );
    });

    it('should default variant to classic_era', async () => {
      await controller.getQuestsForInstance(63);

      expect(mockService.getQuestsForInstance).toHaveBeenCalledWith(
        63,
        'classic_era',
      );
    });

    it('should pass the variant parameter through', async () => {
      await controller.getQuestsForInstance(228, 'classic_anniversary');

      expect(mockService.getQuestsForInstance).toHaveBeenCalledWith(
        228,
        'classic_anniversary',
      );
    });

    it('should throw BadRequestException for invalid variant', async () => {
      await expect(
        controller.getQuestsForInstance(63, 'invalid_variant'),
      ).rejects.toThrow('Invalid variant');
    });
  });

  describe('getQuestChain()', () => {
    it('should return the quest chain', async () => {
      const result = await controller.getQuestChain(2040);

      expect(result).toEqual(mockQuests);
      expect(mockService.getQuestChain).toHaveBeenCalledWith(2040);
    });
  });
});
