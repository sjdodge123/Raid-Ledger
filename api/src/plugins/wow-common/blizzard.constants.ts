/**
 * Blizzard API constants, types, and static lookup data.
 * Extracted from blizzard.service.ts for file size compliance (ROK-711).
 */
import type { MemoryCacheEntry } from '../../common/swr-cache';

// ── Exported Interfaces ──────────────────────────────────────────────────────

/** Equipment item from the Blizzard API */
export interface BlizzardEquipmentItem {
  slot: string;
  name: string;
  itemId: number;
  quality: string;
  itemLevel: number;
  itemSubclass: string | null;
  enchantments?: Array<{ displayString: string; enchantmentId?: number }>;
  sockets?: Array<{ socketType: string; itemId?: number }>;
  stats?: Array<{ type: string; name: string; value: number }>;
  armor?: number;
  binding?: string;
  requiredLevel?: number;
  weapon?: {
    damageMin: number;
    damageMax: number;
    attackSpeed: number;
    dps: number;
  };
  description?: string;
  setName?: string;
  iconUrl?: string;
}

/** Inferred specialization from Blizzard talent data */
export interface InferredSpecialization {
  spec: string | null;
  role: 'tank' | 'healer' | 'dps' | null;
  talents: unknown;
}

/** Equipment data returned from the Blizzard API */
export interface BlizzardCharacterEquipment {
  equippedItemLevel: number | null;
  items: BlizzardEquipmentItem[];
  syncedAt: string;
}

/** Character profile data returned from the Blizzard API */
export interface BlizzardCharacterProfile {
  name: string;
  realm: string;
  class: string;
  spec: string | null;
  role: 'tank' | 'healer' | 'dps' | null;
  level: number;
  race: string;
  faction: 'alliance' | 'horde';
  itemLevel: number | null;
  avatarUrl: string | null;
  renderUrl: string | null;
  profileUrl: string | null;
}

export interface WowRealm {
  name: string;
  slug: string;
  id: number;
}

/** WoW dungeon/raid instance from the Journal API */
export interface WowInstance {
  id: number;
  name: string;
  shortName?: string;
  expansion: string;
  minimumLevel?: number | null;
  maximumLevel?: number | null;
}

/** Enriched instance detail with level requirements */
export interface WowInstanceDetail extends WowInstance {
  minimumLevel: number | null;
  maximumLevel?: number | null;
  maxPlayers: number | null;
  category: 'dungeon' | 'raid';
}

/** Sub-instance definition for Classic dungeon complexes */
export interface SubInstance {
  idSuffix: number;
  name: string;
  shortName: string;
  minimumLevel: number;
  maximumLevel: number;
}

// ── Cache Types ──────────────────────────────────────────────────────────────

export type RealmCacheEntry = MemoryCacheEntry<WowRealm[]>;
export type InstanceListCacheData = {
  dungeons: WowInstance[];
  raids: WowInstance[];
};
export type InstanceListCacheEntry = MemoryCacheEntry<InstanceListCacheData>;
export type InstanceDetailCacheEntry = MemoryCacheEntry<WowInstanceDetail>;

// ── Constants ────────────────────────────────────────────────────────────────

/** Token expiry buffer in seconds */
export const TOKEN_EXPIRY_BUFFER = 300;

/** Realm cache TTL: 1 hour */
export const REALM_CACHE_TTL = 60 * 60 * 1000;

/** Instance cache TTL: 24 hours */
export const INSTANCE_CACHE_TTL = 24 * 60 * 60 * 1000;

/** Spec-to-role mapping for WoW specializations */
export const SPEC_ROLE_MAP: Record<string, 'tank' | 'healer' | 'dps'> = {
  Blood: 'tank',
  Frost: 'dps',
  Unholy: 'dps',
  Havoc: 'dps',
  Vengeance: 'tank',
  Balance: 'dps',
  Feral: 'dps',
  Guardian: 'tank',
  Restoration: 'healer',
  Devastation: 'dps',
  Preservation: 'healer',
  Augmentation: 'dps',
  'Beast Mastery': 'dps',
  Marksmanship: 'dps',
  Survival: 'dps',
  Arcane: 'dps',
  Fire: 'dps',
  Brewmaster: 'tank',
  Mistweaver: 'healer',
  Windwalker: 'dps',
  Holy: 'healer',
  Protection: 'tank',
  Retribution: 'dps',
  Discipline: 'healer',
  Shadow: 'dps',
  Assassination: 'dps',
  Outlaw: 'dps',
  Subtlety: 'dps',
  Elemental: 'dps',
  Enhancement: 'dps',
  Affliction: 'dps',
  Demonology: 'dps',
  Destruction: 'dps',
  Arms: 'dps',
  Fury: 'dps',
};

/**
 * Classic WoW talent tree names -> role mapping.
 * Key = class name, value = map of tree name -> role.
 */
export const CLASSIC_TALENT_TREE_ROLES: Record<
  string,
  Record<string, 'tank' | 'healer' | 'dps'>
> = {
  Druid: {
    Balance: 'dps',
    'Feral Combat': 'dps',
    Feral: 'dps',
    Restoration: 'healer',
    Guardian: 'tank',
  },
  Warrior: { Arms: 'dps', Fury: 'dps', Protection: 'tank' },
  Paladin: { Holy: 'healer', Protection: 'tank', Retribution: 'dps' },
  Priest: { Discipline: 'healer', Holy: 'healer', Shadow: 'dps' },
  Mage: { Arcane: 'dps', Fire: 'dps', Frost: 'dps' },
  Warlock: { Affliction: 'dps', Demonology: 'dps', Destruction: 'dps' },
  Rogue: { Assassination: 'dps', Combat: 'dps', Subtlety: 'dps' },
  Hunter: { 'Beast Mastery': 'dps', Marksmanship: 'dps', Survival: 'dps' },
  Shaman: { Elemental: 'dps', Enhancement: 'dps', Restoration: 'healer' },
  'Death Knight': { Blood: 'tank', Frost: 'dps', Unholy: 'dps' },
};

/**
 * Build Blizzard API namespace prefixes from a game's stored prefix.
 * Null means retail (no prefix). Non-null is appended with a hyphen.
 * @param apiNamespacePrefix - The game's stored namespace prefix (e.g., 'classic1x', 'classicann', null for retail)
 */
export function getNamespacePrefixes(apiNamespacePrefix: string | null): {
  static: string;
  dynamic: string;
  profile: string;
} {
  if (!apiNamespacePrefix) {
    return { static: 'static', dynamic: 'dynamic', profile: 'profile' };
  }
  return {
    static: `static-${apiNamespacePrefix}`,
    dynamic: `dynamic-${apiNamespacePrefix}`,
    profile: `profile-${apiNamespacePrefix}`,
  };
}
