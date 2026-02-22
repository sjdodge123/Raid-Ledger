import { Test, TestingModule } from '@nestjs/testing';
import { BossEncountersController } from './boss-encounters.controller';
import { BossEncountersService } from './boss-encounters.service';
import { Reflector } from '@nestjs/core';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';

describe('BossEncountersController', () => {
  let controller: BossEncountersController;
  let mockService: {
    getBossesForInstance: jest.Mock;
    getLootForBoss: jest.Mock;
  };

  const mockBosses = [
    {
      id: 1,
      instanceId: 409,
      name: 'Ragnaros',
      order: 10,
      expansion: 'classic',
      sodModified: false,
    },
  ];

  const mockLoot = [
    {
      id: 1,
      bossId: 1,
      itemId: 17182,
      itemName: 'Sulfuras, Hand of Ragnaros',
      slot: 'Main Hand',
      quality: 'Legendary',
      itemLevel: 80,
      dropRate: '0.0400',
      expansion: 'classic',
      classRestrictions: null,
      iconUrl: null,
    },
  ];

  beforeEach(async () => {
    mockService = {
      getBossesForInstance: jest.fn().mockResolvedValue(mockBosses),
      getLootForBoss: jest.fn().mockResolvedValue(mockLoot),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BossEncountersController],
      providers: [
        { provide: BossEncountersService, useValue: mockService },
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

    controller = module.get<BossEncountersController>(BossEncountersController);
  });

  describe('getBossesForInstance()', () => {
    it('should return bosses for an instance', async () => {
      const result = await controller.getBossesForInstance(409, 'classic_era');

      expect(result).toEqual(mockBosses);
      expect(mockService.getBossesForInstance).toHaveBeenCalledWith(
        409,
        'classic_era',
      );
    });

    it('should default variant to classic_era', async () => {
      await controller.getBossesForInstance(409);

      expect(mockService.getBossesForInstance).toHaveBeenCalledWith(
        409,
        'classic_era',
      );
    });

    it('should pass the variant parameter through', async () => {
      await controller.getBossesForInstance(532, 'classic_anniversary');

      expect(mockService.getBossesForInstance).toHaveBeenCalledWith(
        532,
        'classic_anniversary',
      );
    });

    it('should throw BadRequestException for invalid variant', async () => {
      await expect(
        controller.getBossesForInstance(409, 'invalid_variant'),
      ).rejects.toThrow('Invalid variant');
    });
  });

  describe('getLootForBoss()', () => {
    it('should return loot for a boss', async () => {
      const result = await controller.getLootForBoss(1, 'classic_era');

      expect(result).toEqual(mockLoot);
      expect(mockService.getLootForBoss).toHaveBeenCalledWith(1, 'classic_era');
    });

    it('should default variant to classic_era', async () => {
      await controller.getLootForBoss(1);

      expect(mockService.getLootForBoss).toHaveBeenCalledWith(1, 'classic_era');
    });

    it('should throw BadRequestException for invalid variant', async () => {
      await expect(
        controller.getLootForBoss(1, 'invalid_variant'),
      ).rejects.toThrow('Invalid variant');
    });
  });
});
