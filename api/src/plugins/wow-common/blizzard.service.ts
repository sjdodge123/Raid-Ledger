import { Injectable, Logger } from '@nestjs/common';
import { memorySwr } from '../../common/swr-cache';
import type { WowGameVariant } from '@raid-ledger/contract';

import {
  type BlizzardCharacterEquipment,
  type BlizzardCharacterProfile,
  type InferredSpecialization,
  type WowRealm,
  type WowInstance,
  type WowInstanceDetail,
  type RealmCacheEntry,
  type InstanceListCacheEntry,
  type InstanceDetailCacheEntry,
  REALM_CACHE_TTL,
  INSTANCE_CACHE_TTL,
} from './blizzard.constants';
import { BlizzardAuthService } from './blizzard-auth.service';
import * as profileH from './blizzard-profile.helpers';
import * as equipH from './blizzard-equipment.helpers';
import * as profH from './blizzard-professions.helpers';
import * as specH from './blizzard-spec.helpers';
import * as instH from './blizzard-instance.helpers';
import * as instFetch from './blizzard-instance.fetch';
import type { ExternalCharacterProfessions } from '../plugin-host/extension-types';

// Re-export types for backward compatibility
export type {
  BlizzardEquipmentItem,
  InferredSpecialization,
  BlizzardCharacterEquipment,
  BlizzardCharacterProfile,
  WowRealm,
  WowInstance,
  WowInstanceDetail,
} from './blizzard.constants';

@Injectable()
export class BlizzardService {
  private readonly logger = new Logger(BlizzardService.name);
  private realmCache = new Map<string, RealmCacheEntry>();
  private instanceListCache = new Map<string, InstanceListCacheEntry>();
  private instanceDetailCache = new Map<string, InstanceDetailCacheEntry>();

  constructor(private readonly auth: BlizzardAuthService) {}

  /** Fetch a character profile from the Blizzard API.
   * @param apiNamespacePrefix - From the game row (null for retail)
   */
  async fetchCharacterProfile(
    name: string,
    realm: string,
    region: string,
    apiNamespacePrefix: string | null = null,
  ): Promise<BlizzardCharacterProfile> {
    const token = await this.auth.getAccessToken(region);
    const data = await profileH.fetchProfileData(
      name,
      realm,
      region,
      apiNamespacePrefix,
      token,
      this.logger,
    );
    return profileH.buildProfileResult(
      data.profile,
      data.avatarUrl,
      data.renderUrl,
      data.itemLevel,
      apiNamespacePrefix,
      region,
      data.realmSlug,
      data.charName,
    );
  }

  /** Fetch character equipment from the Blizzard API. */
  async fetchCharacterEquipment(
    name: string,
    realm: string,
    region: string,
    apiNamespacePrefix: string | null = null,
  ): Promise<BlizzardCharacterEquipment | null> {
    const token = await this.auth.getAccessToken(region);
    return equipH.fetchCharacterEquipment(
      name,
      realm,
      region,
      apiNamespacePrefix,
      token,
      this.logger,
    );
  }

  /** Fetch character professions from the Blizzard API. */
  async fetchCharacterProfessions(
    name: string,
    realm: string,
    region: string,
    apiNamespacePrefix: string | null = null,
  ): Promise<ExternalCharacterProfessions | null> {
    const token = await this.auth.getAccessToken(region);
    return profH.fetchCharacterProfessions(
      name,
      realm,
      region,
      apiNamespacePrefix,
      token,
      this.logger,
    );
  }

  /** Fetch character specializations from the Blizzard API. */
  async fetchCharacterSpecializations(
    name: string,
    realm: string,
    region: string,
    characterClass: string,
    apiNamespacePrefix: string | null = null,
  ): Promise<InferredSpecialization> {
    const token = await this.auth.getAccessToken(region);
    return specH.fetchCharacterSpecializations(
      name,
      realm,
      region,
      characterClass,
      apiNamespacePrefix,
      token,
      this.logger,
    );
  }

  /** Fetch the realm list for a given region and namespace. */
  async fetchRealmList(
    region: string,
    apiNamespacePrefix: string | null = null,
  ): Promise<WowRealm[]> {
    const cacheKey = `${region}:${apiNamespacePrefix ?? 'retail'}`;
    return memorySwr({
      cache: this.realmCache,
      key: cacheKey,
      ttlMs: REALM_CACHE_TTL,
      fetcher: async () => {
        const token = await this.auth.getAccessToken(region);
        return instH.fetchRealmListFromApi(
          region,
          apiNamespacePrefix,
          token,
          this.logger,
        );
      },
    });
  }

  async fetchAllInstances(
    region: string,
    gameVariant: WowGameVariant = 'retail',
  ): Promise<{ dungeons: WowInstance[]; raids: WowInstance[] }> {
    return memorySwr({
      cache: this.instanceListCache,
      key: `${region}:${gameVariant}`,
      ttlMs: INSTANCE_CACHE_TTL,
      fetcher: async () => {
        const token = await this.auth.getAccessToken(region);
        return instFetch.fetchAllInstancesFromApi(region, gameVariant, token);
      },
    });
  }

  async fetchInstanceDetail(
    instanceId: number,
    region: string,
    gameVariant: WowGameVariant = 'retail',
  ): Promise<WowInstanceDetail> {
    return memorySwr({
      cache: this.instanceDetailCache,
      key: `${region}:${gameVariant}:${instanceId}`,
      ttlMs: INSTANCE_CACHE_TTL,
      fetcher: async () => {
        const token = await this.auth.getAccessToken(region);
        return instFetch.fetchInstanceDetailFromApi(
          instanceId,
          region,
          gameVariant,
          token,
        );
      },
    });
  }

  async fetchBlizzardApi<T = unknown>(
    url: string,
    region: string = 'us',
  ): Promise<T | null> {
    const token = await this.auth.getAccessToken(region);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      this.logger.warn(`Blizzard API ${res.status}: ${url}`);
      return null;
    }
    return res.json() as Promise<T>;
  }
}
