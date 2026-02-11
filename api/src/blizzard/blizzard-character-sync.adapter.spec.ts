import { Test, TestingModule } from '@nestjs/testing';
import { BlizzardCharacterSyncAdapter } from './blizzard-character-sync.adapter';
import { BlizzardService } from './blizzard.service';

describe('BlizzardCharacterSyncAdapter', () => {
  let adapter: BlizzardCharacterSyncAdapter;
  let mockBlizzardService: {
    fetchCharacterProfile: jest.Mock;
    fetchCharacterSpecializations: jest.Mock;
    fetchCharacterEquipment: jest.Mock;
  };

  beforeEach(async () => {
    mockBlizzardService = {
      fetchCharacterProfile: jest.fn(),
      fetchCharacterSpecializations: jest.fn(),
      fetchCharacterEquipment: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlizzardCharacterSyncAdapter,
        { provide: BlizzardService, useValue: mockBlizzardService },
      ],
    }).compile();

    adapter = module.get<BlizzardCharacterSyncAdapter>(
      BlizzardCharacterSyncAdapter,
    );
  });

  describe('gameSlugs', () => {
    it('should include all WoW game slugs', () => {
      expect(adapter.gameSlugs).toEqual([
        'wow',
        'world-of-warcraft',
        'wow-classic',
        'wow-classic-era',
      ]);
    });
  });

  describe('resolveGameSlugs()', () => {
    it('should return retail slugs for retail variant', () => {
      expect(adapter.resolveGameSlugs('retail')).toEqual([
        'wow',
        'world-of-warcraft',
      ]);
    });

    it('should return retail slugs when no variant specified', () => {
      expect(adapter.resolveGameSlugs()).toEqual(['wow', 'world-of-warcraft']);
    });

    it('should return classic slugs for classic_era variant', () => {
      expect(adapter.resolveGameSlugs('classic_era')).toEqual([
        'wow-classic',
        'wow-classic-era',
      ]);
    });

    it('should return classic slugs for classic variant', () => {
      expect(adapter.resolveGameSlugs('classic')).toEqual([
        'wow-classic',
        'wow-classic-era',
      ]);
    });

    it('should return classic slugs for classic_anniversary variant', () => {
      expect(adapter.resolveGameSlugs('classic_anniversary')).toEqual([
        'wow-classic',
        'wow-classic-era',
      ]);
    });
  });

  describe('fetchProfile()', () => {
    it('should delegate to BlizzardService.fetchCharacterProfile', async () => {
      const mockProfile = {
        name: 'Thrall',
        realm: 'area-52',
        class: 'Shaman',
        spec: 'Enhancement',
        role: 'dps' as const,
        level: 80,
        race: 'Orc',
        faction: 'horde',
        itemLevel: 480,
        avatarUrl: null,
        renderUrl: null,
        profileUrl: null,
      };
      mockBlizzardService.fetchCharacterProfile.mockResolvedValue(mockProfile);

      const result = await adapter.fetchProfile(
        'Thrall',
        'area-52',
        'us',
        'retail',
      );

      expect(result).toBe(mockProfile);
      expect(mockBlizzardService.fetchCharacterProfile).toHaveBeenCalledWith(
        'Thrall',
        'area-52',
        'us',
        'retail',
      );
    });

    it('should default to retail when no gameVariant specified', async () => {
      mockBlizzardService.fetchCharacterProfile.mockResolvedValue({});

      await adapter.fetchProfile('Thrall', 'area-52', 'us');

      expect(mockBlizzardService.fetchCharacterProfile).toHaveBeenCalledWith(
        'Thrall',
        'area-52',
        'us',
        'retail',
      );
    });
  });

  describe('fetchSpecialization()', () => {
    it('should delegate to BlizzardService.fetchCharacterSpecializations', async () => {
      const mockSpec = { spec: 'Enhancement', role: 'dps' as const };
      mockBlizzardService.fetchCharacterSpecializations.mockResolvedValue(
        mockSpec,
      );

      const result = await adapter.fetchSpecialization(
        'Thrall',
        'area-52',
        'us',
        'Shaman',
        'retail',
      );

      expect(result).toBe(mockSpec);
      expect(
        mockBlizzardService.fetchCharacterSpecializations,
      ).toHaveBeenCalledWith('Thrall', 'area-52', 'us', 'Shaman', 'retail');
    });
  });

  describe('fetchEquipment()', () => {
    it('should delegate to BlizzardService.fetchCharacterEquipment', async () => {
      const mockEquipment = {
        equippedItemLevel: 480,
        items: [],
        syncedAt: '2025-01-01T00:00:00.000Z',
      };
      mockBlizzardService.fetchCharacterEquipment.mockResolvedValue(
        mockEquipment,
      );

      const result = await adapter.fetchEquipment(
        'Thrall',
        'area-52',
        'us',
        'retail',
      );

      expect(result).toBe(mockEquipment);
    });

    it('should return empty equipment when BlizzardService returns null', async () => {
      mockBlizzardService.fetchCharacterEquipment.mockResolvedValue(null);

      const result = await adapter.fetchEquipment(
        'Thrall',
        'area-52',
        'us',
        'retail',
      );

      expect(result.equippedItemLevel).toBeNull();
      expect(result.items).toEqual([]);
    });
  });
});
