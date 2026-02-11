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
}

/** Equipment data returned from an external game API */
export interface ExternalCharacterEquipment {
  equippedItemLevel: number | null;
  items: ExternalEquipmentItem[];
  syncedAt: string;
}

/** Character profile data returned from an external game API */
export interface ExternalCharacterProfile {
  name: string;
  realm: string;
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
