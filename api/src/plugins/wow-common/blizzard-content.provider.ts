import { Injectable } from '@nestjs/common';
import { BlizzardService } from './blizzard.service';
import type { ContentProvider } from '../plugin-host/extension-points';
import type {
  ExternalRealm,
  ExternalContentInstance,
  ExternalContentInstanceDetail,
} from '../plugin-host/extension-types';
import type { WowGameVariant } from '@raid-ledger/contract';
import { ALL_WOW_GAME_SLUGS } from './manifest';

/**
 * Content provider bridging ContentProvider interface to BlizzardService.
 * The `gameVariant` parameter is passed through from the caller.
 * For realm fetching, it carries apiNamespacePrefix (null for retail).
 * For instance fetching, it still carries WowGameVariant for content filtering.
 */
@Injectable()
export class BlizzardContentProvider implements ContentProvider {
  readonly gameSlugs = ALL_WOW_GAME_SLUGS;

  constructor(private readonly blizzardService: BlizzardService) {}

  async fetchRealms(
    region: string,
    gameVariant?: string,
  ): Promise<ExternalRealm[]> {
    return this.blizzardService.fetchRealmList(region, gameVariant ?? null);
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
