import { Test, TestingModule } from '@nestjs/testing';
import { BlizzardCharacterSyncAdapter } from './blizzard-character-sync.adapter';
import { BlizzardService } from './blizzard.service';
import { ALL_WOW_GAME_SLUGS } from './manifest';

let adapter: BlizzardCharacterSyncAdapter;
let mockBlizzardService: {
  fetchCharacterProfile: jest.Mock;
  fetchCharacterSpecializations: jest.Mock;
  fetchCharacterEquipment: jest.Mock;
};

async function setupEach() {
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
  adapter = module.get(BlizzardCharacterSyncAdapter);
}

describe('BlizzardCharacterSyncAdapter — slugs', () => {
  beforeEach(() => setupEach());

  it('should include all WoW game slugs (retail + classic variants)', () => {
    expect(adapter.gameSlugs).toEqual(ALL_WOW_GAME_SLUGS);
    expect(adapter.gameSlugs).toContain('world-of-warcraft');
    expect(adapter.gameSlugs).toContain('world-of-warcraft-classic');
  });

  it('should return all WoW slugs regardless of variant', () => {
    expect(adapter.resolveGameSlugs('retail')).toEqual(ALL_WOW_GAME_SLUGS);
    expect(adapter.resolveGameSlugs('classic_era')).toEqual(ALL_WOW_GAME_SLUGS);
    expect(adapter.resolveGameSlugs('classic1x')).toEqual(ALL_WOW_GAME_SLUGS);
  });

  it('should return all WoW slugs when no variant specified', () => {
    expect(adapter.resolveGameSlugs()).toEqual(ALL_WOW_GAME_SLUGS);
  });
});

describe('BlizzardCharacterSyncAdapter — fetchProfile', () => {
  beforeEach(() => setupEach());

  it('should delegate to BlizzardService with apiNamespacePrefix', async () => {
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
      'classic1x',
    );
    expect(result).toBe(mockProfile);
    expect(mockBlizzardService.fetchCharacterProfile).toHaveBeenCalledWith(
      'Thrall',
      'area-52',
      'us',
      'classic1x',
    );
  });

  it('should pass null when no gameVariant specified (retail)', async () => {
    mockBlizzardService.fetchCharacterProfile.mockResolvedValue({});
    await adapter.fetchProfile('Thrall', 'area-52', 'us');
    expect(mockBlizzardService.fetchCharacterProfile).toHaveBeenCalledWith(
      'Thrall',
      'area-52',
      'us',
      null,
    );
  });
});

describe('BlizzardCharacterSyncAdapter — fetchSpecialization', () => {
  beforeEach(() => setupEach());

  it('should delegate to BlizzardService with apiNamespacePrefix', async () => {
    const mockSpec = { spec: 'Enhancement', role: 'dps' as const };
    mockBlizzardService.fetchCharacterSpecializations.mockResolvedValue(
      mockSpec,
    );
    const result = await adapter.fetchSpecialization(
      'Thrall',
      'area-52',
      'us',
      'Shaman',
      'classic1x',
    );
    expect(result).toBe(mockSpec);
    expect(
      mockBlizzardService.fetchCharacterSpecializations,
    ).toHaveBeenCalledWith('Thrall', 'area-52', 'us', 'Shaman', 'classic1x');
  });
});

describe('BlizzardCharacterSyncAdapter — fetchEquipment', () => {
  beforeEach(() => setupEach());

  it('should delegate to BlizzardService with apiNamespacePrefix', async () => {
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
      'classic1x',
    );
    expect(result).toBe(mockEquipment);
  });

  it('should return empty equipment when BlizzardService returns null', async () => {
    mockBlizzardService.fetchCharacterEquipment.mockResolvedValue(null);
    const result = await adapter.fetchEquipment(
      'Thrall',
      'area-52',
      'us',
      'classic1x',
    );
    expect(result.equippedItemLevel).toBeNull();
    expect(result.items).toEqual([]);
  });
});
