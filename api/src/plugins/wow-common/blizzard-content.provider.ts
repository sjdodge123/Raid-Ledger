import { Injectable } from '@nestjs/common';
import { BlizzardService } from './blizzard.service';
import type { ContentProvider } from '../plugin-host/extension-points';
import type {
  ExternalRealm,
  ExternalContentInstance,
  ExternalContentInstanceDetail,
} from '../plugin-host/extension-types';
import type { WowGameVariant } from '@raid-ledger/contract';

@Injectable()
export class BlizzardContentProvider implements ContentProvider {
  readonly gameSlugs = ['world-of-warcraft', 'world-of-warcraft-classic'];

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
    region: string,
    gameVariant?: string,
  ): Promise<ExternalContentInstance[]> {
    const result = await this.blizzardService.fetchAllInstances(
      region,
      (gameVariant as WowGameVariant) ?? 'retail',
    );
    return [...result.dungeons, ...result.raids];
  }

  async fetchInstanceDetail(
    instanceId: number,
    region: string,
    gameVariant?: string,
  ): Promise<ExternalContentInstanceDetail | null> {
    try {
      const result = await this.blizzardService.fetchInstanceDetail(
        instanceId,
        region,
        (gameVariant as WowGameVariant) ?? 'retail',
      );
      return {
        ...result,
        minimumLevel: result.minimumLevel ?? null,
        maximumLevel: result.maximumLevel ?? null,
      };
    } catch {
      return null;
    }
  }
}
