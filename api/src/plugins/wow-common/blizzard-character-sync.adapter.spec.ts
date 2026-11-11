import { Test, TestingModule } from '@nestjs/testing';
import { ForeverDisplayEquipmentService } from './forever-display-equipment.service';
import { ForeverDisplayTalentsService } from './forever-display-talents.service';
import { ForeverDisplayLockoutsService } from './forever-display-lockouts.service';
import { WowDisplayTooltipService } from './wow-display-tooltip.service';
import { BlizzardCharacterSyncAdapter } from './blizzard-character-sync.adapter';
import { BlizzardService } from './blizzard.service';
import { ALL_WOW_GAME_SLUGS } from './manifest';

let adapter: BlizzardCharacterSyncAdapter;
let talentsResolve: jest.Mock;
let lockoutsResolve: jest.Mock;
let equipmentResolve: jest.Mock;
let decorate: jest.Mock;
let mockBlizzardService: {
  fetchCharacterProfile: jest.Mock;
  fetchCharacterSpecializations: jest.Mock;
  fetchCharacterEquipment: jest.Mock;
  fetchCharacterProfessions: jest.Mock;
};

async function setupEach() {
  mockBlizzardService = {
    fetchCharacterProfile: jest.fn(),
    fetchCharacterSpecializations: jest.fn(),
    fetchCharacterEquipment: jest.fn(),
    fetchCharacterProfessions: jest.fn(),
  };
  talentsResolve = jest.fn();
  lockoutsResolve = jest.fn();
  equipmentResolve = jest.fn();
  decorate = jest.fn();
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      BlizzardCharacterSyncAdapter,
      { provide: BlizzardService, useValue: mockBlizzardService },
      {
        provide: ForeverDisplayEquipmentService,
        useValue: { resolve: equipmentResolve },
      },
      { provide: WowDisplayTooltipService, useValue: { decorate } },
      {
        provide: ForeverDisplayTalentsService,
        useValue: { resolve: talentsResolve },
      },
      {
        provide: ForeverDisplayLockoutsService,
        useValue: { resolve: lockoutsResolve },
      },
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

  it('returns null (not an empty item list) when BlizzardService fails, so the stored gear is kept', async () => {
    mockBlizzardService.fetchCharacterEquipment.mockResolvedValue(null);
    const result = await adapter.fetchEquipment(
      'Thrall',
      'area-52',
      'us',
      'classic1x',
    );
    expect(result).toBeNull();
  });
});

/**
 * ROK-1130 — fetchProfessions adapter tests.
 *
 * Architect §3 (mandatory correction): the adapter must NOT fall back to
 * empty arrays. It is a thin pass-through to BlizzardService. The
 * orchestrator's `if (professions !== null)` check is the *only* source
 * of "skip the column" behavior. Returning empty arrays here would erase
 * the 5xx-skip signal before the orchestrator ever saw it.
 */
describe('BlizzardCharacterSyncAdapter — fetchProfessions', () => {
  beforeEach(() => setupEach());

  it('should delegate to BlizzardService with apiNamespacePrefix', async () => {
    const mockProfessions = {
      primary: [
        {
          id: 197,
          name: 'Tailoring',
          slug: 'tailoring',
          skillLevel: 450,
          maxSkillLevel: 450,
          tiers: [],
        },
      ],
      secondary: [],
      syncedAt: '2026-04-28T00:00:00.000Z',
    };
    mockBlizzardService.fetchCharacterProfessions.mockResolvedValue(
      mockProfessions,
    );
    const result = await adapter.fetchProfessions(
      'Thrall',
      'area-52',
      'us',
      'classic1x',
    );
    expect(result).toBe(mockProfessions);
    expect(mockBlizzardService.fetchCharacterProfessions).toHaveBeenCalledWith(
      'Thrall',
      'area-52',
      'us',
      'classic1x',
    );
  });

  it('should pass null gameVariant through when retail (no variant)', async () => {
    mockBlizzardService.fetchCharacterProfessions.mockResolvedValue({
      primary: [],
      secondary: [],
      syncedAt: '2026-04-28T00:00:00.000Z',
    });
    await adapter.fetchProfessions('Thrall', 'area-52', 'us');
    expect(mockBlizzardService.fetchCharacterProfessions).toHaveBeenCalledWith(
      'Thrall',
      'area-52',
      'us',
      null,
    );
  });

  it('should pass through null when BlizzardService returns null (no fallback — architect §3)', async () => {
    mockBlizzardService.fetchCharacterProfessions.mockResolvedValue(null);
    const result = await adapter.fetchProfessions(
      'Thrall',
      'area-52',
      'us',
      'classic1x',
    );
    expect(result).toBeNull();
  });
});

describe('BlizzardCharacterSyncAdapter — resolveDisplayTalents (ROK-1744)', () => {
  beforeEach(() => setupEach());

  it('delegates to ForeverDisplayTalentsService', async () => {
    const dto = { format: 'forever' };
    talentsResolve.mockResolvedValue(dto);
    const row = {
      id: 'c1',
      gameVariant: 'wow_forever',
      talents: null,
      lastSyncedAt: null,
    };
    await expect(adapter.resolveDisplayTalents(row)).resolves.toBe(dto);
    expect(talentsResolve).toHaveBeenCalledWith(row);
  });
});

describe('BlizzardCharacterSyncAdapter — resolveDisplayLockouts (ROK-1743)', () => {
  beforeEach(() => setupEach());

  it('delegates to ForeverDisplayLockoutsService', async () => {
    const dto = { source: 'addon', syncedAt: '', instances: [] };
    lockoutsResolve.mockResolvedValue(dto);
    const row = { id: 'c1', gameVariant: 'wow_forever' };
    await expect(adapter.resolveDisplayLockouts(row)).resolves.toBe(dto);
    expect(lockoutsResolve).toHaveBeenCalledWith(row);
  });
});

describe('BlizzardCharacterSyncAdapter — resolveDisplayEquipment (ROK-2176)', () => {
  beforeEach(() => setupEach());

  const gear = (itemId: number) => ({
    equippedItemLevel: null,
    items: [
      {
        slot: 'HEAD',
        name: 'Helm',
        itemId,
        quality: 'EPIC',
        itemLevel: 66,
        itemSubclass: null,
        enchantments: [],
        sockets: [],
      },
    ],
    syncedAt: '2026-11-01T00:00:00Z',
  });
  const row = (equipment: ReturnType<typeof gear> | null) => ({
    id: 'char-1',
    gameVariant: 'wow_forever',
    equipment,
  });

  it('decorates the addon gear when the Forever resolver returns some', async () => {
    const addon = gear(1);
    const decorated = { ...addon, equippedItemLevel: 1 };
    equipmentResolve.mockResolvedValue(addon);
    decorate.mockResolvedValue(decorated);
    const input = row(gear(2));
    expect(await adapter.resolveDisplayEquipment(input)).toBe(decorated);
    expect(decorate).toHaveBeenCalledWith(input, addon);
  });

  it('decorates the stored Armory gear when the Forever resolver has no opinion', async () => {
    const armory = gear(2);
    const decorated = { ...armory, equippedItemLevel: 2 };
    equipmentResolve.mockResolvedValue(undefined);
    decorate.mockResolvedValue(decorated);
    const input = row(armory);
    expect(await adapter.resolveDisplayEquipment(input)).toBe(decorated);
    expect(decorate).toHaveBeenCalledWith(input, armory);
  });

  it('is undefined (keep the stored value) with no addon and no Armory gear', async () => {
    equipmentResolve.mockResolvedValue(undefined);
    expect(await adapter.resolveDisplayEquipment(row(null))).toBeUndefined();
    expect(decorate).not.toHaveBeenCalled();
  });

  // Codex P2: addon gear is Forever by definition — a manual / roster-created
  // Forever character can keep gameVariant null and still gets tooltips.
  it('decorates addon gear even when the character has no variant', async () => {
    const addon = gear(1);
    const decorated = { ...addon, equippedItemLevel: 1 };
    equipmentResolve.mockResolvedValue(addon);
    decorate.mockResolvedValue(decorated);
    const input = { ...row(null), gameVariant: null };
    expect(await adapter.resolveDisplayEquipment(input)).toBe(decorated);
    expect(decorate).toHaveBeenCalledWith(input, addon);
  });

  // Review MAJOR 2: Wowhead envs 16/4 only describe vanilla-era items.
  it.each(['wow_forever', 'classic_era'])(
    'decorates %s Armory gear',
    async (gameVariant) => {
      equipmentResolve.mockResolvedValue(undefined);
      decorate.mockResolvedValue(gear(9));
      const input = { ...row(gear(2)), gameVariant };
      expect(await adapter.resolveDisplayEquipment(input)).toEqual(gear(9));
      expect(decorate).toHaveBeenCalledTimes(1);
    },
  );

  // Codex P2: classic_anniversary realms are TBC — envs 16/4 never serve it.
  it.each(['retail', 'classic', 'classic_anniversary', null])(
    'leaves %s gear undecorated (no tooltip read, no Wowhead enqueue)',
    async (gameVariant) => {
      equipmentResolve.mockResolvedValue(undefined);
      const input = { ...row(gear(2)), gameVariant };
      expect(await adapter.resolveDisplayEquipment(input)).toBeUndefined();
      expect(decorate).not.toHaveBeenCalled();
    },
  );
});
