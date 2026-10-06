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
import { foreverSeedOnlyList } from './forever-instance-data';
import { isNamespaceRefusal } from './blizzard-upstream-error';
import { resolveBlizzardNamespacePrefix } from './forever-namespace.resolver';
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

/**
 * How long a namespace refusal (Blizzard 403 on the realm index) is remembered
 * (TDB:1786). The public realm route would otherwise re-hit Blizzard and send
 * another Sentry 502 on every call for a variant it never serves. Within the
 * window the original exception is rethrown, so Sentry reports it once (its
 * already-captured check skips the repeats); the next real 403 after expiry
 * reports again, which keeps a bad namespace constant visible.
 */
const REALM_REFUSAL_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class BlizzardService {
  private readonly logger = new Logger(BlizzardService.name);
  private realmCache = new Map<string, RealmCacheEntry>();
  /** Realm cache key -> the 403 to rethrow, and the epoch ms it expires at. */
  private readonly realmRefusals = new Map<
    string,
    { error: unknown; until: number }
  >();
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
    // Keyed on the RESOLVED prefix (ROK-1717): a Forever override is a new
    // key, so a 403 remembered for the old prefix cannot block it.
    const resolved = resolveBlizzardNamespacePrefix(apiNamespacePrefix);
    const cacheKey = `${region}:${resolved ?? 'retail'}`;
    this.throwIfRealmRefused(cacheKey);
    try {
      const realms = await memorySwr({
        cache: this.realmCache,
        key: cacheKey,
        ttlMs: REALM_CACHE_TTL,
        // Never record a refusal in here: a stale hit runs this fetcher as a
        // background refresh whose failure memorySwr swallows.
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
      this.realmRefusals.delete(cacheKey);
      return realms;
    } catch (err) {
      if (isNamespaceRefusal(err)) this.rememberRealmRefusal(cacheKey, err);
      throw err;
    }
  }

  /**
   * Drop every region's cached realm list and remembered 403 for one resolved
   * namespace prefix (ROK-1717: called when the Forever prefix changes).
   * @param resolvedPrefix - The prefix as sent to Blizzard (e.g. `classicforever`).
   */
  purgeNamespace(resolvedPrefix: string): void {
    const suffix = `:${resolvedPrefix}`;
    for (const map of [this.realmCache, this.realmRefusals]) {
      for (const key of [...map.keys()]) {
        if (key.endsWith(suffix)) map.delete(key);
      }
    }
  }

  /** Keep a 403 so the next calls in the window rethrow this same object. */
  private rememberRealmRefusal(cacheKey: string, error: unknown): void {
    this.realmRefusals.set(cacheKey, {
      error,
      until: Date.now() + REALM_REFUSAL_TTL_MS,
    });
  }

  /**
   * Answer a remembered 403 without calling Blizzard. A live cached realm list
   * always wins. Rethrows the original instance on purpose: Sentry skips an
   * exception object it has already captured, so the repeats stay out of it.
   */
  private throwIfRealmRefused(cacheKey: string): void {
    const now = Date.now();
    const cached = this.realmCache.get(cacheKey);
    if (cached && now < cached.expiresAt) return;
    const refusal = this.realmRefusals.get(cacheKey);
    if (refusal === undefined || now >= refusal.until) return;
    throw refusal.error;
  }

  async fetchAllInstances(
    region: string,
    gameVariant: WowGameVariant = 'retail',
  ): Promise<{ dungeons: WowInstance[]; raids: WowInstance[] }> {
    const load = () =>
      memorySwr({
        cache: this.instanceListCache,
        key: `${region}:${gameVariant}`,
        ttlMs: INSTANCE_CACHE_TTL,
        fetcher: async () => {
          const token = await this.auth.getAccessToken(region);
          return instFetch.fetchAllInstancesFromApi(region, gameVariant, token);
        },
      });
    if (gameVariant !== 'wow_forever') return load();
    // ROK-1719: Forever planning survives a Blizzard outage with the seeded
    // instances. Deliberately outside the SWR fetcher so the seed-only list
    // is never cached over the full journal list.
    try {
      return await load();
    } catch (err) {
      this.logger.warn(
        `Forever instance list served seed-only: ${(err as Error).message}`,
      );
      return foreverSeedOnlyList();
    }
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
