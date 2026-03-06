import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SettingsService, SETTINGS_EVENTS } from '../../settings/settings.service';
import { memorySwr } from '../../common/swr-cache';
import type { WowGameVariant } from '@raid-ledger/contract';
import {
  type BlizzardCharacterProfile, type BlizzardCharacterEquipment,
  type InferredSpecialization, type WowRealm, type WowInstance,
  type WowInstanceDetail, type RealmCacheEntry,
  type InstanceListCacheEntry, type InstanceListCacheData,
  type InstanceDetailCacheEntry,
  SPEC_ROLE_MAP, TOKEN_EXPIRY_BUFFER, REALM_CACHE_TTL, INSTANCE_CACHE_TTL,
  getNamespacePrefixes,
} from './blizzard.constants';
import { CLASSIC_SUB_INSTANCES, CLASSIC_INSTANCE_LEVELS, getShortName } from './blizzard-instance-data';
import { buildCharacterParams, fetchCharacterMedia, buildEquipmentResult, specToRole, inferClassicSpec } from './blizzard-character.helpers';

// Re-export types for backward compatibility
export type {
  BlizzardEquipmentItem, InferredSpecialization, BlizzardCharacterEquipment,
  BlizzardCharacterProfile, WowRealm, WowInstance, WowInstanceDetail,
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

  /** Clear cached token when Blizzard config updates. */
  @OnEvent(SETTINGS_EVENTS.BLIZZARD_UPDATED)
  handleBlizzardConfigUpdate(): void {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.tokenFetchPromise = null;
    this.logger.log('Blizzard config updated — cached token cleared');
  }

  /** Normalize realm name for Blizzard API slug format. */
  normalizeRealmSlug(realm: string): string {
    return realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-').trim();
  }

  /** Map a WoW spec name to a role. */
  specToRole(spec: string): 'tank' | 'healer' | 'dps' | null {
    return SPEC_ROLE_MAP[spec] ?? null;
  }

  /** Fetch a WoW character profile from the Blizzard API. */
  async fetchCharacterProfile(
    name: string, realm: string, region: string, gameVariant: WowGameVariant = 'retail',
  ): Promise<BlizzardCharacterProfile> {
    const token = await this.getAccessToken(region);
    const { realmSlug, charName, namespace, baseUrl } = buildCharacterParams(name, realm, region, gameVariant);
    const profileUrl = `${baseUrl}/profile/wow/character/${realmSlug}/${charName}`;
    const profileRes = await fetch(`${profileUrl}?namespace=${namespace}&locale=en_US`, { headers: { Authorization: `Bearer ${token}` } });
    if (!profileRes.ok) {
      const text = await profileRes.text();
      this.logger.error(`Blizzard profile API error: ${profileRes.status} ${text}`);
      if (profileRes.status === 404) throw new NotFoundException(`Character "${name}" not found on ${realm} (${region.toUpperCase()}). Check the spelling and realm.`);
      throw new Error(`Blizzard API error (${profileRes.status}). Please try again later.`);
    }
    const profile = (await profileRes.json()) as { name: string; level: number; character_class: { name: string }; active_spec?: { name: string }; race: { name: string }; faction: { type: string }; realm: { name: string }; equipped_item_level?: number };
    const { avatarUrl, renderUrl } = await fetchCharacterMedia(profileUrl, namespace, token);
    let itemLevel: number | null = profile.equipped_item_level ?? null;
    if (itemLevel === null) itemLevel = await this.fetchEquipItemLevel(profileUrl, namespace, token);
    const specName = profile.active_spec?.name ?? null;
    return {
      name: profile.name, realm: profile.realm.name, class: profile.character_class.name,
      spec: specName, role: specName ? specToRole(specName) : null, level: profile.level,
      race: profile.race.name, faction: profile.faction.type.toLowerCase() as 'alliance' | 'horde',
      itemLevel, avatarUrl, renderUrl,
      profileUrl: gameVariant === 'retail' ? `https://worldofwarcraft.blizzard.com/en-${region}/character/${realmSlug}/${charName}` : null,
    };
  }

  /** Fetch equipped item level from equipment summary endpoint. */
  private async fetchEquipItemLevel(profileUrl: string, namespace: string, token: string): Promise<number | null> {
    try {
      const equipRes = await fetch(`${profileUrl}/equipment?namespace=${namespace}&locale=en_US`, { headers: { Authorization: `Bearer ${token}` } });
      if (equipRes.ok) {
        const equip = (await equipRes.json()) as { equipped_item_level?: number };
        return equip.equipped_item_level ?? null;
      }
    } catch (err) { this.logger.warn(`Failed to fetch equipment summary: ${err}`); }
    return null;
  }

  /** Fetch a WoW character's equipped items from the Blizzard API. */
  async fetchCharacterEquipment(
    name: string, realm: string, region: string, gameVariant: WowGameVariant = 'retail',
  ): Promise<BlizzardCharacterEquipment | null> {
    try {
      const token = await this.getAccessToken(region);
      const { realmSlug, charName, namespace, baseUrl } = buildCharacterParams(name, realm, region, gameVariant);
      const url = `${baseUrl}/profile/wow/character/${realmSlug}/${charName}/equipment?namespace=${namespace}&locale=en_US`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { this.logger.warn(`Equipment fetch failed for ${charName}-${realmSlug}: ${res.status}`); return null; }
      const data = await res.json();
      const iconUrls = await this.fetchItemIconUrls(data, token);
      const result = buildEquipmentResult(data, iconUrls);
      if (result.items.length > 0) {
        const sample = result.items.slice(0, 3).map((i) => `${i.name}: quality=${i.quality}, iLvl=${i.itemLevel}`);
        this.logger.log(`Equipment for ${charName}: ${result.items.length} items. Sample: [${sample.join('; ')}]`);
      }
      return result;
    } catch (err) { this.logger.warn(`Failed to fetch character equipment: ${err}`); return null; }
  }

  /** Batch-fetch item icon URLs from Blizzard media endpoints. */
  private async fetchItemIconUrls(data: { equipped_items?: Array<{ item: { id: number }; media?: { key?: { href: string } } }> }, token: string): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    const items = (data.equipped_items ?? []).filter((i) => i.media?.key?.href).map((i) => ({ itemId: i.item.id, mediaHref: i.media!.key!.href }));
    if (items.length === 0) return result;
    await Promise.all(items.map(async ({ itemId, mediaHref }) => {
      try {
        const res = await fetch(mediaHref, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const media = (await res.json()) as { assets?: Array<{ key: string; value: string }> };
        const icon = media.assets?.find((a) => a.key === 'icon');
        if (icon?.value) {
          const iconMatch = icon.value.match(/icons\/\d+\/(.+)$/);
          result.set(itemId, iconMatch ? `https://render.worldofwarcraft.com/us/icons/56/${iconMatch[1]}` : icon.value);
        }
      } catch { /* Non-fatal */ }
    }));
    return result;
  }

  /** Infer a character's specialization from the Blizzard specializations endpoint. */
  async fetchCharacterSpecializations(
    name: string, realm: string, region: string, characterClass: string, gameVariant: WowGameVariant = 'retail',
  ): Promise<InferredSpecialization> {
    try {
      const token = await this.getAccessToken(region);
      const { realmSlug, charName, namespace, baseUrl } = buildCharacterParams(name, realm, region, gameVariant);
      const url = `${baseUrl}/profile/wow/character/${realmSlug}/${charName}/specializations?namespace=${namespace}&locale=en_US`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { spec: null, role: null, talents: null };
      const data = await res.json();
      if (data.active_specialization?.name) return this.buildRetailSpecResult(data);
      const trees = data.specializations ?? data.specialization_groups?.[0]?.specializations ?? [];
      if (trees.length === 0) return { spec: null, role: null, talents: null };
      return inferClassicSpec(trees, characterClass);
    } catch (err) { this.logger.debug(`Failed to fetch specializations: ${err}`); return { spec: null, role: null, talents: null }; }
  }

  /** Build retail spec result with talent loadout data. */
  private buildRetailSpecResult(data: Record<string, unknown>): InferredSpecialization {
    const specName = (data.active_specialization as { name: string }).name;
    const classTalents: Array<{ name: string; id?: number }> = [];
    for (const tree of ((data.specializations ?? []) as Array<{ talents?: Array<Record<string, unknown>> }>)) {
      for (const t of tree.talents ?? []) {
        const talent = t.talent as { name?: string; id?: number } | undefined;
        const spell = t.spell_tooltip as { spell?: { name?: string; id?: number } } | undefined;
        const tName = talent?.name ?? spell?.spell?.name;
        if (tName) classTalents.push({ name: tName, id: talent?.id ?? spell?.spell?.id });
      }
    }
    const heroTree = data.active_hero_talent_tree as { hero_talent_tree?: { name?: string }; talents?: Array<{ talent?: { name?: string; id?: number } }> } | undefined;
    const heroTalents = heroTree ? { treeName: heroTree.hero_talent_tree?.name ?? null, talents: (heroTree.talents ?? []).filter((t) => t.talent?.name).map((t) => ({ name: t.talent!.name!, id: t.talent?.id })) } : null;
    return { spec: specName, role: specToRole(specName), talents: { format: 'retail', specName, classTalents, heroTalents } };
  }

  /** Fetch the list of WoW realms for a region with SWR caching. */
  async fetchRealmList(region: string, gameVariant: WowGameVariant = 'retail'): Promise<WowRealm[]> {
    return memorySwr({ cache: this.realmCache, key: `${region}:${gameVariant}`, ttlMs: REALM_CACHE_TTL, fetcher: () => this._fetchRealmListFromApi(region, gameVariant) });
  }

  private async _fetchRealmListFromApi(region: string, gameVariant: WowGameVariant): Promise<WowRealm[]> {
    const token = await this.getAccessToken(region);
    const { dynamic: dynamicPrefix } = getNamespacePrefixes(gameVariant);
    const response = await fetch(`https://${region}.api.blizzard.com/data/wow/realm/index?namespace=${dynamicPrefix}-${region}&locale=en_US`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { const text = await response.text(); this.logger.error(`Blizzard realm index error: ${response.status} ${text}`); throw new Error(`Failed to fetch realm list (${response.status})`); }
    const data = (await response.json()) as { realms: Array<{ name: string; slug: string; id: number }> };
    return data.realms.map((r) => ({ name: r.name, slug: r.slug, id: r.id })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Fetch all dungeon and raid instances for a WoW variant with SWR caching. */
  async fetchAllInstances(region: string, gameVariant: WowGameVariant = 'retail'): Promise<{ dungeons: WowInstance[]; raids: WowInstance[] }> {
    return memorySwr({ cache: this.instanceListCache, key: `${region}:${gameVariant}`, ttlMs: INSTANCE_CACHE_TTL, fetcher: () => this._fetchAllInstancesFromApi(region, gameVariant) });
  }

  private async _fetchAllInstancesFromApi(region: string, gameVariant: WowGameVariant): Promise<InstanceListCacheData> {
    const token = await this.getAccessToken(region);
    const namespace = `static-${region}`;
    const baseUrl = `https://${region}.api.blizzard.com`;
    const indexRes = await fetch(`${baseUrl}/data/wow/journal-expansion/index?namespace=${namespace}&locale=en_US`, { headers: { Authorization: `Bearer ${token}` } });
    if (!indexRes.ok) throw new Error(`Failed to fetch expansion index (${indexRes.status})`);
    const indexData = (await indexRes.json()) as { tiers: Array<{ id: number; name: string }> };
    const expansionDetails = await this.fetchExpansionDetails(indexData.tiers, baseUrl, namespace, token);
    let { dungeons, raids } = this.mergeExpansionInstances(expansionDetails);
    ({ dungeons, raids } = this.filterByVariant(dungeons, raids, gameVariant));
    dungeons = this.deduplicateById(dungeons); raids = this.deduplicateById(raids);
    if (gameVariant !== 'retail') { dungeons = this.expandSubInstances(dungeons); raids = this.expandSubInstances(raids); }
    const enrich = (inst: WowInstance): WowInstance => {
      const levels = gameVariant !== 'retail' ? CLASSIC_INSTANCE_LEVELS[inst.name] : undefined;
      return { ...inst, shortName: inst.shortName ?? getShortName(inst.name), minimumLevel: inst.minimumLevel ?? levels?.minimumLevel ?? null, maximumLevel: inst.maximumLevel ?? levels?.maximumLevel ?? null };
    };
    return { dungeons: dungeons.map(enrich), raids: raids.map(enrich) };
  }

  private async fetchExpansionDetails(tiers: Array<{ id: number; name: string }>, baseUrl: string, namespace: string, token: string): Promise<Array<{ expansionName: string; detail: { dungeons?: Array<{ id: number; name: string }>; raids?: Array<{ id: number; name: string }> } } | null>> {
    return Promise.all(tiers.map(async (tier) => {
      try {
        const res = await fetch(`${baseUrl}/data/wow/journal-expansion/${tier.id}?namespace=${namespace}&locale=en_US`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return null;
        const detail = await res.json();
        return { expansionName: detail.name ?? tier.name, detail };
      } catch { return null; }
    }));
  }

  private mergeExpansionInstances(details: Array<{ expansionName: string; detail: { dungeons?: Array<{ id: number; name: string }>; raids?: Array<{ id: number; name: string }> } } | null>): { dungeons: WowInstance[]; raids: WowInstance[] } {
    const dungeons: WowInstance[] = []; const raids: WowInstance[] = [];
    for (const result of details) {
      if (!result) continue;
      for (const d of result.detail.dungeons ?? []) dungeons.push({ id: d.id, name: d.name, expansion: result.expansionName });
      for (const r of result.detail.raids ?? []) raids.push({ id: r.id, name: r.name, expansion: result.expansionName });
    }
    return { dungeons, raids };
  }

  private filterByVariant(dungeons: WowInstance[], raids: WowInstance[], gameVariant: WowGameVariant): { dungeons: WowInstance[]; raids: WowInstance[] } {
    if (gameVariant === 'classic_era') {
      const exps = new Set(['Classic']);
      return { dungeons: dungeons.filter((d) => exps.has(d.expansion)), raids: raids.filter((r) => exps.has(r.expansion)) };
    }
    if (gameVariant === 'classic' || gameVariant === 'classic_anniversary') {
      const exps = new Set(['Classic', 'Burning Crusade', 'Wrath of the Lich King', 'Cataclysm']);
      return { dungeons: dungeons.filter((d) => exps.has(d.expansion)), raids: raids.filter((r) => exps.has(r.expansion)) };
    }
    return { dungeons, raids };
  }

  private expandSubInstances(instances: WowInstance[]): WowInstance[] {
    const result: WowInstance[] = [];
    for (const inst of instances) {
      const subs = CLASSIC_SUB_INSTANCES[inst.name];
      if (subs) { for (const sub of subs) result.push({ id: inst.id * 100 + sub.idSuffix, name: sub.name, shortName: sub.shortName, expansion: inst.expansion, minimumLevel: sub.minimumLevel, maximumLevel: sub.maximumLevel }); }
      else result.push(inst);
    }
    return result;
  }

  private deduplicateById(instances: WowInstance[]): WowInstance[] {
    const seen = new Set<number>();
    return instances.filter((inst) => { if (seen.has(inst.id)) return false; seen.add(inst.id); return true; });
  }

  /** Fetch detail for a specific instance with SWR caching. */
  async fetchInstanceDetail(instanceId: number, region: string, gameVariant: WowGameVariant = 'retail'): Promise<WowInstanceDetail> {
    return memorySwr({ cache: this.instanceDetailCache, key: `${region}:${gameVariant}:${instanceId}`, ttlMs: INSTANCE_CACHE_TTL, fetcher: () => this._fetchInstanceDetailFromApi(instanceId, region, gameVariant) });
  }

  private async _fetchInstanceDetailFromApi(instanceId: number, region: string, gameVariant: WowGameVariant): Promise<WowInstanceDetail> {
    if (instanceId > 10000) { const synth = this.resolveSyntheticInstance(instanceId); if (synth) return synth; }
    const token = await this.getAccessToken(region);
    const url = `https://${region}.api.blizzard.com/data/wow/journal-instance/${instanceId}?namespace=static-${region}&locale=en_US`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to fetch instance detail (${res.status})`);
    const data = (await res.json()) as { id: number; name: string; minimum_level?: number; modes?: Array<{ mode: { type: string }; players: number }>; category?: { type: string }; expansion?: { name: string } };
    const maxPlayers = data.modes?.length ? Math.max(...data.modes.map((m) => m.players)) : null;
    const category: 'dungeon' | 'raid' = data.category?.type?.toLowerCase() === 'raid' ? 'raid' : 'dungeon';
    const levelOverride = gameVariant !== 'retail' ? CLASSIC_INSTANCE_LEVELS[data.name] : undefined;
    return { id: data.id, name: data.name, shortName: getShortName(data.name), expansion: data.expansion?.name ?? 'Unknown', minimumLevel: levelOverride?.minimumLevel ?? data.minimum_level ?? null, maximumLevel: levelOverride?.maximumLevel ?? null, maxPlayers, category };
  }

  private resolveSyntheticInstance(instanceId: number): WowInstanceDetail | null {
    const suffix = instanceId % 100;
    for (const [, subs] of Object.entries(CLASSIC_SUB_INSTANCES)) {
      for (const sub of subs) {
        if (sub.idSuffix === suffix) return { id: instanceId, name: sub.name, shortName: sub.shortName, expansion: 'Classic', minimumLevel: sub.minimumLevel, maximumLevel: sub.maximumLevel, maxPlayers: 5, category: 'dungeon' };
      }
    }
    return null;
  }

  /** Fetch JSON from a Blizzard API URL with automatic auth. */
  async fetchBlizzardApi<T = unknown>(url: string, region: string = 'us'): Promise<T | null> {
    const token = await this.getAccessToken(region);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { this.logger.warn(`Blizzard API ${res.status}: ${url}`); return null; }
    return res.json() as Promise<T>;
  }

  /** Get OAuth2 access token (single-flight pattern). */
  private async getAccessToken(region: string): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) return this.accessToken;
    if (this.tokenFetchPromise) return this.tokenFetchPromise;
    this.tokenFetchPromise = this.fetchNewToken(region);
    try { return await this.tokenFetchPromise; } finally { this.tokenFetchPromise = null; }
  }

  private async fetchNewToken(region: string): Promise<string> {
    const config = await this.settingsService.getBlizzardConfig();
    if (!config) throw new Error('Blizzard API credentials not configured');
    const response = await fetch(`https://${region}.battle.net/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    if (!response.ok) { const errorText = await response.text(); this.logger.error(`Failed to get Blizzard access token: ${response.status} ${errorText}`); throw new Error(`Failed to get Blizzard access token: ${response.statusText}`); }
    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + (data.expires_in - TOKEN_EXPIRY_BUFFER) * 1000);
    return this.accessToken;
  }
}
