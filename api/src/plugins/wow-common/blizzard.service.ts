import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SettingsService } from '../../settings/settings.service';
import { SETTINGS_EVENTS } from '../../settings/settings.types';
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
  type InstanceListCacheData,
  type InstanceDetailCacheEntry,
  SPEC_ROLE_MAP,
  TOKEN_EXPIRY_BUFFER,
  REALM_CACHE_TTL,
  INSTANCE_CACHE_TTL,
} from './blizzard.constants';
import { buildCharacterParams } from './blizzard-character.helpers';
import * as profileH from './blizzard-profile.helpers';
import * as equipH from './blizzard-equipment.helpers';
import * as profH from './blizzard-professions.helpers';
import * as specH from './blizzard-spec.helpers';
import * as instH from './blizzard-instance.helpers';
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
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private tokenFetchPromise: Promise<string> | null = null;
  private realmCache = new Map<string, RealmCacheEntry>();
  private instanceListCache = new Map<string, InstanceListCacheEntry>();
  private instanceDetailCache = new Map<string, InstanceDetailCacheEntry>();

  constructor(private readonly settingsService: SettingsService) {}

  @OnEvent(SETTINGS_EVENTS.BLIZZARD_UPDATED)
  handleBlizzardConfigUpdate(): void {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.tokenFetchPromise = null;
    this.logger.log('Blizzard config updated — cached token cleared');
  }

  normalizeRealmSlug(realm: string): string {
    return realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-').trim();
  }

  specToRole(spec: string): 'tank' | 'healer' | 'dps' | null {
    return SPEC_ROLE_MAP[spec] ?? null;
  }

  /** Fetch a character profile from the Blizzard API.
   * @param apiNamespacePrefix - From the game row (null for retail)
   */
  async fetchCharacterProfile(
    name: string,
    realm: string,
    region: string,
    apiNamespacePrefix: string | null = null,
  ): Promise<BlizzardCharacterProfile> {
    const token = await this.getAccessToken(region);
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

  /** Fetch character equipment from the Blizzard API.
   * @param apiNamespacePrefix - From the game row (null for retail)
   */
  async fetchCharacterEquipment(
    name: string,
    realm: string,
    region: string,
    apiNamespacePrefix: string | null = null,
  ): Promise<BlizzardCharacterEquipment | null> {
    const token = await this.getAccessToken(region);
    return equipH.fetchCharacterEquipment(
      name,
      realm,
      region,
      apiNamespacePrefix,
      token,
      this.logger,
    );
  }

  /** Fetch character professions from the Blizzard API.
   * @param apiNamespacePrefix - From the game row (null for retail)
   */
  async fetchCharacterProfessions(
    name: string,
    realm: string,
    region: string,
    apiNamespacePrefix: string | null = null,
  ): Promise<ExternalCharacterProfessions | null> {
    const token = await this.getAccessToken(region);
    return profH.fetchCharacterProfessions(
      name,
      realm,
      region,
      apiNamespacePrefix,
      token,
      this.logger,
    );
  }

  /** Fetch character specializations from the Blizzard API.
   * @param apiNamespacePrefix - From the game row (null for retail)
   */
  async fetchCharacterSpecializations(
    name: string,
    realm: string,
    region: string,
    characterClass: string,
    apiNamespacePrefix: string | null = null,
  ): Promise<InferredSpecialization> {
    try {
      const token = await this.getAccessToken(region);
      const { realmSlug, charName, namespace, baseUrl } = buildCharacterParams(
        name,
        realm,
        region,
        apiNamespacePrefix,
      );
      const url = `${baseUrl}/profile/wow/character/${realmSlug}/${charName}/specializations?namespace=${namespace}&locale=en_US`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return specH.NO_SPEC;
      const data = (await res.json()) as Record<string, unknown>;
      return specH.parseSpecData(data, characterClass);
    } catch (err) {
      this.logger.debug(`Failed to fetch specializations: ${err}`);
      return specH.NO_SPEC;
    }
  }

  /** Fetch the realm list for a given region and namespace.
   * @param apiNamespacePrefix - From the game row (null for retail)
   */
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
        const token = await this.getAccessToken(region);
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
      fetcher: () => this._fetchAllInstancesFromApi(region, gameVariant),
    });
  }

  private async _fetchAllInstancesFromApi(
    region: string,
    gameVariant: WowGameVariant,
  ): Promise<InstanceListCacheData> {
    const token = await this.getAccessToken(region);
    const tiers = await instH.fetchExpansionIndex(region, token);
    const details = await instH.fetchExpansionDetails(
      tiers,
      `https://${region}.api.blizzard.com`,
      `static-${region}`,
      token,
    );
    let { dungeons, raids } = instH.mergeExpansionInstances(details);
    ({ dungeons, raids } = instH.filterByVariant(dungeons, raids, gameVariant));
    dungeons = instH.deduplicateById(dungeons);
    raids = instH.deduplicateById(raids);
    if (gameVariant !== 'retail') {
      dungeons = instH.expandSubInstances(dungeons);
      raids = instH.expandSubInstances(raids);
    }
    return {
      dungeons: dungeons.map((i) => instH.enrichInstance(i, gameVariant)),
      raids: raids.map((i) => instH.enrichInstance(i, gameVariant)),
    };
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
      fetcher: () =>
        this._fetchInstanceDetailFromApi(instanceId, region, gameVariant),
    });
  }

  private async _fetchInstanceDetailFromApi(
    instanceId: number,
    region: string,
    gameVariant: WowGameVariant,
  ): Promise<WowInstanceDetail> {
    if (instanceId > 10000) {
      const synth = instH.resolveSyntheticInstance(instanceId);
      if (synth) return synth;
    }
    const token = await this.getAccessToken(region);
    const url = `https://${region}.api.blizzard.com/data/wow/journal-instance/${instanceId}?namespace=static-${region}&locale=en_US`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok)
      throw new Error(`Failed to fetch instance detail (${res.status})`);
    const data = (await res.json()) as {
      id: number;
      name: string;
      minimum_level?: number;
      modes?: Array<{ mode: { type: string }; players: number }>;
      category?: { type: string };
      expansion?: { name: string };
    };
    return instH.buildInstanceDetail(data, gameVariant);
  }

  async fetchBlizzardApi<T = unknown>(
    url: string,
    region: string = 'us',
  ): Promise<T | null> {
    const token = await this.getAccessToken(region);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      this.logger.warn(`Blizzard API ${res.status}: ${url}`);
      return null;
    }
    return res.json() as Promise<T>;
  }

  private async getAccessToken(region: string): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry)
      return this.accessToken;
    if (this.tokenFetchPromise) return this.tokenFetchPromise;
    this.tokenFetchPromise = this.fetchNewToken(region);
    try {
      return await this.tokenFetchPromise;
    } finally {
      this.tokenFetchPromise = null;
    }
  }

  private async fetchNewToken(region: string): Promise<string> {
    const config = await this.settingsService.getBlizzardConfig();
    if (!config) throw new Error('Blizzard API credentials not configured');
    const response = await fetch(`https://${region}.battle.net/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `Failed to get Blizzard access token: ${response.status} ${errorText}`,
      );
      throw new Error(
        `Failed to get Blizzard access token: ${response.statusText}`,
      );
    }
    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(
      Date.now() + (data.expires_in - TOKEN_EXPIRY_BUFFER) * 1000,
    );
    return this.accessToken;
  }
}
