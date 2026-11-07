/**
 * Game-agnostic data types for plugin extension points.
 * These replace Blizzard-specific types from blizzard.service.ts,
 * allowing any game plugin to provide character/content data.
 */

/** Equipment item from an external game API */
export interface ExternalEquipmentItem {
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

/** Inferred specialization from external talent/build data */
export interface ExternalInferredSpecialization {
  spec: string | null;
  role: 'tank' | 'healer' | 'dps' | null;
  talents?: unknown;
}

/** Equipment data returned from an external game API */
export interface ExternalCharacterEquipment {
  equippedItemLevel: number | null;
  items: ExternalEquipmentItem[];
  syncedAt: string;
}

/** Profession tier (e.g., "Dragon Isles Tailoring") */
export interface ExternalProfessionTier {
  id: number;
  name: string;
  skillLevel: number;
  maxSkillLevel: number;
}

/** Single profession entry (primary or secondary) */
export interface ExternalProfessionEntry {
  id: number;
  name: string;
  /** Lowercased name with spaces replaced by '-' */
  slug: string;
  skillLevel: number;
  maxSkillLevel: number;
  tiers: ExternalProfessionTier[];
}

/** Profession data returned from an external game API */
export interface ExternalCharacterProfessions {
  primary: ExternalProfessionEntry[];
  secondary: ExternalProfessionEntry[];
  syncedAt: string;
}

/**
 * Completed quest ids from the Blizzard `quests/completed` endpoint (ROK-2109).
 * Ascending, deduped, capped at the addon limit keeping the LOWEST ids;
 * `completedTruncated` is set only when the cap cut the list. Quest names are
 * never stored.
 */
export interface ExternalCharacterQuests {
  fetchedAt: string;
  completed: number[];
  completedTruncated?: true;
}

/** Character profile data returned from an external game API */
export interface ExternalCharacterProfile {
  name: string;
  /** Null for a realmless WoW: Forever character (ROK-2102). */
  realm: string | null;
  class: string;
  spec: string | null;
  role: 'tank' | 'healer' | 'dps' | null;
  level: number;
  race: string;
  faction: string | null;
  itemLevel: number | null;
  avatarUrl: string | null;
  renderUrl: string | null;
  profileUrl: string | null;
  /** Blizzard character id as a string, when the adapter surfaces one (ROK-1722). */
  externalId?: string | null;
  /** The body's raw `ruleset` value, unmapped (ROK-2100 maps it). */
  rulesetRaw?: unknown;
}

/** Realm info from an external game API */
export interface ExternalRealm {
  name: string;
  slug: string;
  id: number;
}

/** Game content instance (dungeon, raid, etc.) */
export interface ExternalContentInstance {
  id: number;
  name: string;
  shortName?: string;
  expansion: string;
  minimumLevel?: number | null;
  maximumLevel?: number | null;
}

/** Enriched content instance with detail info */
export interface ExternalContentInstanceDetail extends ExternalContentInstance {
  minimumLevel: number | null;
  maximumLevel: number | null;
  maxPlayers: number | null;
  category: 'dungeon' | 'raid';
}

/** Definition for a cron job provided by a plugin */
export interface CronJobDefinition {
  name: string;
  cronExpression: string;
  handler: () => void | Promise<void>;
}
