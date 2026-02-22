import { Injectable } from '@nestjs/common';
import { BlizzardService } from './blizzard.service';
import type { CharacterSyncAdapter } from '../plugin-host/extension-points';
import type {
  ExternalCharacterProfile,
  ExternalInferredSpecialization,
  ExternalCharacterEquipment,
} from '../plugin-host/extension-types';
import type { WowGameVariant } from '@raid-ledger/contract';

@Injectable()
export class BlizzardCharacterSyncAdapter implements CharacterSyncAdapter {
  readonly gameSlugs = ['world-of-warcraft', 'world-of-warcraft-classic'];

  constructor(private readonly blizzardService: BlizzardService) {}

  resolveGameSlugs(gameVariant?: string): string[] {
    if (
      gameVariant === 'classic_era' ||
      gameVariant === 'classic' ||
      gameVariant === 'classic_anniversary'
    ) {
      return ['world-of-warcraft-classic'];
    }
    if (!gameVariant || gameVariant === 'retail') {
      return ['world-of-warcraft'];
    }
    return [];
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
      (gameVariant as WowGameVariant) ?? 'retail',
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
      (gameVariant as WowGameVariant) ?? 'retail',
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
      (gameVariant as WowGameVariant) ?? 'retail',
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
