import { Injectable } from '@nestjs/common';
import { BlizzardService } from './blizzard.service';
import type { CharacterSyncAdapter } from '../plugin-host/extension-points';
import type {
  ExternalCharacterProfile,
  ExternalInferredSpecialization,
  ExternalCharacterEquipment,
} from '../plugin-host/extension-types';
import { ALL_WOW_GAME_SLUGS } from './manifest';

/**
 * Adapter bridging CharacterSyncAdapter interface to BlizzardService.
 * The `gameVariant` parameter now carries the game's apiNamespacePrefix
 * (null for retail, e.g. 'classic1x', 'classicann').
 */
@Injectable()
export class BlizzardCharacterSyncAdapter implements CharacterSyncAdapter {
  readonly gameSlugs = ALL_WOW_GAME_SLUGS;

  constructor(private readonly blizzardService: BlizzardService) {}

  /** @deprecated Game ID is now the lookup key; kept for interface compat. */
  resolveGameSlugs(gameVariant?: string): string[] {
    if (!gameVariant) return ALL_WOW_GAME_SLUGS;
    return ALL_WOW_GAME_SLUGS;
  }

  async fetchProfile(
    name: string,
    realm: string,
    region: string,
    gameVariant?: string,
  ): Promise<ExternalCharacterProfile> {
    return this.blizzardService.fetchCharacterProfile(
      name,
      realm,
      region,
      gameVariant ?? null,
    );
  }

  async fetchSpecialization(
    name: string,
    realm: string,
    region: string,
    characterClass: string,
    gameVariant?: string,
  ): Promise<ExternalInferredSpecialization> {
    return this.blizzardService.fetchCharacterSpecializations(
      name,
      realm,
      region,
      characterClass,
      gameVariant ?? null,
    );
  }

  async fetchEquipment(
    name: string,
    realm: string,
    region: string,
    gameVariant?: string,
  ): Promise<ExternalCharacterEquipment> {
    const result = await this.blizzardService.fetchCharacterEquipment(
      name,
      realm,
      region,
      gameVariant ?? null,
    );
    return (
      result ?? {
        equippedItemLevel: null,
        items: [],
        syncedAt: new Date().toISOString(),
      }
    );
  }
}
