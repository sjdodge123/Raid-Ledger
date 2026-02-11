import { Injectable } from '@nestjs/common';
import { BlizzardService } from './blizzard.service';
import type { ContentProvider } from '../plugins/plugin-host/extension-points';
import type {
  ExternalRealm,
  ExternalContentInstance,
  ExternalContentInstanceDetail,
} from '../plugins/plugin-host/extension-types';
import type { WowGameVariant } from '@raid-ledger/contract';

@Injectable()
export class BlizzardContentProvider implements ContentProvider {
  readonly gameSlugs = [
    'wow',
    'world-of-warcraft',
    'wow-classic',
    'wow-classic-era',
  ];

  constructor(private readonly blizzardService: BlizzardService) {}

  async fetchRealms(
    region: string,
    gameVariant?: string,
  ): Promise<ExternalRealm[]> {
    return this.blizzardService.fetchRealmList(
      region,
      (gameVariant as WowGameVariant) ?? 'retail',
    );
  }

  async fetchInstances(
    gameVariant?: string,
  ): Promise<ExternalContentInstance[]> {
    const result = await this.blizzardService.fetchAllInstances(
      'us',
      (gameVariant as WowGameVariant) ?? 'retail',
    );
    return [...result.dungeons, ...result.raids];
  }

  async fetchInstanceDetail(
    instanceId: number,
    gameVariant?: string,
  ): Promise<ExternalContentInstanceDetail | null> {
    try {
      return await this.blizzardService.fetchInstanceDetail(
        instanceId,
        'us',
        (gameVariant as WowGameVariant) ?? 'retail',
      );
    } catch {
      return null;
    }
  }
}
