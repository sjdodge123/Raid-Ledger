import { Test, TestingModule } from '@nestjs/testing';
import { BlizzardContentProvider } from './blizzard-content.provider';
import { BlizzardService } from './blizzard.service';
import { ALL_WOW_GAME_SLUGS } from './manifest';

let provider: BlizzardContentProvider;
let mockBlizzardService: {
  fetchRealmList: jest.Mock;
  fetchAllInstances: jest.Mock;
  fetchInstanceDetail: jest.Mock;
};

async function setupEach() {
  mockBlizzardService = {
    fetchRealmList: jest.fn(),
    fetchAllInstances: jest.fn(),
    fetchInstanceDetail: jest.fn(),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      BlizzardContentProvider,
      { provide: BlizzardService, useValue: mockBlizzardService },
    ],
  }).compile();

  provider = module.get<BlizzardContentProvider>(BlizzardContentProvider);
}

async function testFetchInstancesMerge() {
  const mockDungeons = [
    { id: 1, name: 'Mists of Tirna Scithe', expansion: 'Shadowlands' },
  ];
  const mockRaids = [
    { id: 2, name: 'Castle Nathria', expansion: 'Shadowlands' },
  ];
  mockBlizzardService.fetchAllInstances.mockResolvedValue({
    dungeons: mockDungeons,
    raids: mockRaids,
  });

  const result = await provider.fetchInstances('us', 'retail');

  expect(result).toEqual([...mockDungeons, ...mockRaids]);
  expect(result).toHaveLength(2);
}

async function testFetchInstanceDetailDelegation() {
  const mockDetail = {
    id: 1,
    name: 'Castle Nathria',
    expansion: 'Shadowlands',
    minimumLevel: 60,
    maximumLevel: 60,
    maxPlayers: 20,
    category: 'raid' as const,
  };
  mockBlizzardService.fetchInstanceDetail.mockResolvedValue(mockDetail);

  const result = await provider.fetchInstanceDetail(1, 'us', 'retail');

  expect(result).toStrictEqual(mockDetail);
  expect(mockBlizzardService.fetchInstanceDetail).toHaveBeenCalledWith(
    1,
    'us',
    'retail',
  );
}

describe('BlizzardContentProvider — slugs and realms', () => {
  beforeEach(() => setupEach());

  it('should include all WoW game slugs', () => {
    expect(provider.gameSlugs).toEqual(ALL_WOW_GAME_SLUGS);
    expect(provider.gameSlugs).toContain('world-of-warcraft');
    expect(provider.gameSlugs).toContain('world-of-warcraft-classic');
  });

  describe('fetchRealms()', () => {
    it('should delegate to BlizzardService.fetchRealmList', async () => {
      const mockRealms = [
        { name: 'Area 52', slug: 'area-52', id: 1 },
        { name: 'Stormrage', slug: 'stormrage', id: 2 },
      ];
      mockBlizzardService.fetchRealmList.mockResolvedValue(mockRealms);
      const result = await provider.fetchRealms('us', 'classic1x');
      expect(result).toBe(mockRealms);
      expect(mockBlizzardService.fetchRealmList).toHaveBeenCalledWith(
        'us',
        'classic1x',
      );
    });

    it('should pass null when no gameVariant specified (retail)', async () => {
      mockBlizzardService.fetchRealmList.mockResolvedValue([]);
      await provider.fetchRealms('eu');
      expect(mockBlizzardService.fetchRealmList).toHaveBeenCalledWith(
        'eu',
        null,
      );
    });
  });
});

describe('BlizzardContentProvider — instances', () => {
  beforeEach(() => setupEach());

  describe('fetchInstances()', () => {
    it('should merge dungeons and raids from BlizzardService', () =>
      testFetchInstancesMerge());

    it('should pass region and gameVariant to BlizzardService', async () => {
      mockBlizzardService.fetchAllInstances.mockResolvedValue({
        dungeons: [],
        raids: [],
      });
      await provider.fetchInstances('eu', 'classic');
      expect(mockBlizzardService.fetchAllInstances).toHaveBeenCalledWith(
        'eu',
        'classic',
      );
    });

    it('should default to retail when no gameVariant specified', async () => {
      mockBlizzardService.fetchAllInstances.mockResolvedValue({
        dungeons: [],
        raids: [],
      });
      await provider.fetchInstances('us');
      expect(mockBlizzardService.fetchAllInstances).toHaveBeenCalledWith(
        'us',
        'retail',
      );
    });
  });

  describe('fetchInstanceDetail()', () => {
    it('should delegate to BlizzardService.fetchInstanceDetail', () =>
      testFetchInstanceDetailDelegation());

    it('should return null when BlizzardService throws', async () => {
      mockBlizzardService.fetchInstanceDetail.mockRejectedValue(
        new Error('Not found'),
      );
      const result = await provider.fetchInstanceDetail(999, 'us', 'retail');
      expect(result).toBeNull();
    });

    it('should default to retail when no gameVariant specified', async () => {
      mockBlizzardService.fetchInstanceDetail.mockResolvedValue({});
      await provider.fetchInstanceDetail(1, 'us');
      expect(mockBlizzardService.fetchInstanceDetail).toHaveBeenCalledWith(
        1,
        'us',
        'retail',
      );
    });
  });
});
