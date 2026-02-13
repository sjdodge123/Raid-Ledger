import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  SettingsService,
  SETTINGS_EVENTS,
} from '../../settings/settings.service';
import type { WowGameVariant } from '@raid-ledger/contract';

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

/** Spec-to-role mapping for WoW specializations */
const SPEC_ROLE_MAP: Record<string, 'tank' | 'healer' | 'dps'> = {
  // Death Knight
  Blood: 'tank',
  Frost: 'dps',
  Unholy: 'dps',
  // Demon Hunter
  Havoc: 'dps',
  Vengeance: 'tank',
  // Druid
  Balance: 'dps',
  Feral: 'dps',
  Guardian: 'tank',
  Restoration: 'healer',
  // Evoker
  Devastation: 'dps',
  Preservation: 'healer',
  Augmentation: 'dps',
  // Hunter
  'Beast Mastery': 'dps',
  Marksmanship: 'dps',
  Survival: 'dps',
  // Mage
  Arcane: 'dps',
  Fire: 'dps',
  // Monk
  Brewmaster: 'tank',
  Mistweaver: 'healer',
  Windwalker: 'dps',
  // Paladin
  Holy: 'healer',
  Protection: 'tank',
  Retribution: 'dps',
  // Priest
  Discipline: 'healer',
  // "Holy" already mapped above for Paladin; Priest Holy handled by lookup order
  Shadow: 'dps',
  // Rogue
  Assassination: 'dps',
  Outlaw: 'dps',
  Subtlety: 'dps',
  // Shaman
  Elemental: 'dps',
  Enhancement: 'dps',
  // Warlock
  Affliction: 'dps',
  Demonology: 'dps',
  Destruction: 'dps',
  // Warrior
  Arms: 'dps',
  Fury: 'dps',
};

/**
 * Classic WoW talent tree names → role mapping.
 * Key = class name, value = map of tree name → role.
 * Used to infer role from the talent tree with the most points invested.
 */
const CLASSIC_TALENT_TREE_ROLES: Record<
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

/** Token expiry buffer in seconds */
const TOKEN_EXPIRY_BUFFER = 300;

/**
 * Map game variant → Blizzard API namespace prefix.
 * See https://develop.battle.net/documentation/guides/game-data-apis-wow-background
 */
function getNamespacePrefixes(variant: WowGameVariant): {
  static: string;
  dynamic: string;
  profile: string;
} {
  switch (variant) {
    case 'classic_era':
      return {
        static: 'static-classic1x',
        dynamic: 'dynamic-classic1x',
        profile: 'profile-classic1x',
      };
    case 'classic':
      return {
        static: 'static-classic',
        dynamic: 'dynamic-classic',
        profile: 'profile-classic',
      };
    case 'classic_anniversary':
      return {
        static: 'static-classicann',
        dynamic: 'dynamic-classicann',
        profile: 'profile-classicann',
      };
    default:
      return { static: 'static', dynamic: 'dynamic', profile: 'profile' };
  }
}

/** Realm cache TTL: 1 hour */
const REALM_CACHE_TTL = 60 * 60 * 1000;

/** Instance cache TTL: 24 hours */
const INSTANCE_CACHE_TTL = 24 * 60 * 60 * 1000;

export interface WowRealm {
  name: string;
  slug: string;
  id: number;
}

interface RealmCache {
  realms: WowRealm[];
  expiresAt: number;
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

/**
 * Classic dungeon complexes that should be expanded into their individual wings.
 * The retail journal combines these, but Classic has them as separate instances.
 * Key = parent instance name (must match Blizzard journal name exactly).
 */
interface SubInstance {
  idSuffix: number; // appended to parent ID * 100 to create unique IDs
  name: string;
  shortName: string;
  minimumLevel: number;
  maximumLevel: number;
}

const CLASSIC_SUB_INSTANCES: Record<string, SubInstance[]> = {
  'Scarlet Monastery': [
    {
      idSuffix: 1,
      name: 'SM: Graveyard',
      shortName: 'SM:GY',
      minimumLevel: 26,
      maximumLevel: 32,
    },
    {
      idSuffix: 2,
      name: 'SM: Library',
      shortName: 'SM:Lib',
      minimumLevel: 29,
      maximumLevel: 33,
    },
    {
      idSuffix: 3,
      name: 'SM: Armory',
      shortName: 'SM:Arm',
      minimumLevel: 32,
      maximumLevel: 36,
    },
    {
      idSuffix: 4,
      name: 'SM: Cathedral',
      shortName: 'SM:Cath',
      minimumLevel: 34,
      maximumLevel: 40,
    },
  ],
  Maraudon: [
    {
      idSuffix: 1,
      name: 'Maraudon: Purple',
      shortName: 'Mara:P',
      minimumLevel: 40,
      maximumLevel: 49,
    },
    {
      idSuffix: 2,
      name: 'Maraudon: Orange',
      shortName: 'Mara:O',
      minimumLevel: 40,
      maximumLevel: 49,
    },
    {
      idSuffix: 3,
      name: 'Maraudon: Inner',
      shortName: 'Mara:I',
      minimumLevel: 46,
      maximumLevel: 52,
    },
  ],
};

/**
 * Well-known short names for Classic/TBC/WotLK/Cata dungeons and raids.
 * Used to generate abbreviated titles in the event creation form.
 */
const INSTANCE_SHORT_NAMES: Record<string, string> = {
  // Classic dungeons
  'Ragefire Chasm': 'RFC',
  'Wailing Caverns': 'WC',
  Deadmines: 'DM',
  'Shadowfang Keep': 'SFK',
  'Blackfathom Deeps': 'BFD',
  'The Stockade': 'Stocks',
  Gnomeregan: 'Gnomer',
  'Razorfen Kraul': 'RFK',
  'Razorfen Downs': 'RFD',
  "The Temple of Atal'hakkar": 'ST',
  Uldaman: 'Ulda',
  "Zul'Farrak": 'ZF',
  'Blackrock Depths': 'BRD',
  'Lower Blackrock Spire': 'LBRS',
  Scholomance: 'Scholo',
  'Stratholme - Main Gate': 'Strat:Live',
  'Stratholme - Service Entrance': 'Strat:UD',
  'Dire Maul - Capital Gardens': 'DM:E',
  'Dire Maul - Warpwood Quarter': 'DM:W',
  'Dire Maul - Gordok Commons': 'DM:N',
  'Scarlet Halls': 'SH',
  // Classic raids
  'Molten Core': 'MC',
  'Blackwing Lair': 'BWL',
  "Ruins of Ahn'Qiraj": 'AQ20',
  "Temple of Ahn'Qiraj": 'AQ40',
  "Onyxia's Lair": 'Ony',
  // TBC dungeons
  'Hellfire Ramparts': 'Ramps',
  'The Blood Furnace': 'BF',
  'The Shattered Halls': 'SH',
  'The Slave Pens': 'SP',
  'The Underbog': 'UB',
  'The Steamvault': 'SV',
  'Mana-Tombs': 'MT',
  'Auchenai Crypts': 'AC',
  'Sethekk Halls': 'Seth',
  'Shadow Labyrinth': 'SLabs',
  'Old Hillsbrad Foothills': 'OHB',
  'The Black Morass': 'BM',
  'The Mechanar': 'Mech',
  'The Botanica': 'Bot',
  'The Arcatraz': 'Arc',
  "Magisters' Terrace": 'MGT',
  // TBC raids
  Karazhan: 'Kara',
  "Gruul's Lair": 'Gruul',
  "Magtheridon's Lair": 'Mag',
  'Serpentshrine Cavern': 'SSC',
  'The Eye': 'TK',
  'Hyjal Summit': 'Hyjal',
  'Black Temple': 'BT',
  'Sunwell Plateau': 'SWP',
  // WotLK dungeons
  'Utgarde Keep': 'UK',
  'Utgarde Pinnacle': 'UP',
  'The Nexus': 'Nex',
  'The Oculus': 'Ocu',
  'Azjol-Nerub': 'AN',
  "Ahn'kahet: The Old Kingdom": 'OK',
  "Drak'Tharon Keep": 'DTK',
  Gundrak: 'GD',
  'Halls of Stone': 'HoS',
  'Halls of Lightning': 'HoL',
  'The Culling of Stratholme': 'CoS',
  'The Violet Hold': 'VH',
  'Trial of the Champion': 'ToC5',
  'The Forge of Souls': 'FoS',
  'Pit of Saron': 'PoS',
  'Halls of Reflection': 'HoR',
  // WotLK raids
  Naxxramas: 'Naxx',
  'The Obsidian Sanctum': 'OS',
  'The Eye of Eternity': 'EoE',
  Ulduar: 'Uld',
  'Trial of the Crusader': 'ToC',
  'Icecrown Citadel': 'ICC',
  'Ruby Sanctum': 'RS',
  // Cata dungeons
  'Blackrock Caverns': 'BRC',
  'Throne of the Tides': 'ToT',
  'The Stonecore': 'SC',
  'The Vortex Pinnacle': 'VP',
  'Grim Batol': 'GB',
  'Halls of Origination': 'HoO',
  "Lost City of the Tol'vir": 'LC',
  "Zul'Aman": 'ZA',
  "Zul'Gurub": 'ZG',
  'End Time': 'ET',
  'Well of Eternity': 'WoE',
  'Hour of Twilight': 'HoT',
};

/** Generate a short name for an instance (use lookup table or derive from initials) */
function getShortName(name: string): string {
  if (INSTANCE_SHORT_NAMES[name]) return INSTANCE_SHORT_NAMES[name];
  // Derive from initials: "The Deadmines" → "TD", "Blackrock Depths" → "BD"
  const words = name
    .replace(/[^a-zA-Z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= 2) return name; // Too short to abbreviate meaningfully
  return words.map((w) => w[0].toUpperCase()).join('');
}

/**
 * Accurate Classic WoW recommended level ranges for all dungeons and raids.
 * The Blizzard Journal API returns retail scaling levels which are wrong for Classic.
 * These are only applied when gameVariant is not 'retail'.
 */
const CLASSIC_INSTANCE_LEVELS: Record<
  string,
  { minimumLevel: number; maximumLevel: number }
> = {
  // Classic Dungeons
  'Ragefire Chasm': { minimumLevel: 13, maximumLevel: 18 },
  'Wailing Caverns': { minimumLevel: 17, maximumLevel: 24 },
  Deadmines: { minimumLevel: 17, maximumLevel: 26 },
  'Shadowfang Keep': { minimumLevel: 22, maximumLevel: 30 },
  'The Stockade': { minimumLevel: 22, maximumLevel: 30 },
  'Blackfathom Deeps': { minimumLevel: 24, maximumLevel: 32 },
  Gnomeregan: { minimumLevel: 29, maximumLevel: 38 },
  'Scarlet Halls': { minimumLevel: 28, maximumLevel: 38 },
  'Razorfen Kraul': { minimumLevel: 30, maximumLevel: 40 },
  'Razorfen Downs': { minimumLevel: 40, maximumLevel: 50 },
  Uldaman: { minimumLevel: 42, maximumLevel: 52 },
  "Zul'Farrak": { minimumLevel: 44, maximumLevel: 54 },
  "The Temple of Atal'hakkar": { minimumLevel: 50, maximumLevel: 56 },
  'Blackrock Depths': { minimumLevel: 52, maximumLevel: 60 },
  'Lower Blackrock Spire': { minimumLevel: 55, maximumLevel: 60 },
  'Dire Maul - Capital Gardens': { minimumLevel: 55, maximumLevel: 60 },
  'Dire Maul - Gordok Commons': { minimumLevel: 55, maximumLevel: 60 },
  'Dire Maul - Warpwood Quarter': { minimumLevel: 55, maximumLevel: 60 },
  'Stratholme - Main Gate': { minimumLevel: 58, maximumLevel: 60 },
  'Stratholme - Service Entrance': { minimumLevel: 58, maximumLevel: 60 },
  Scholomance: { minimumLevel: 58, maximumLevel: 60 },
  // Classic Raids
  'Molten Core': { minimumLevel: 60, maximumLevel: 60 },
  'Blackwing Lair': { minimumLevel: 60, maximumLevel: 60 },
  "Ruins of Ahn'Qiraj": { minimumLevel: 60, maximumLevel: 60 },
  "Temple of Ahn'Qiraj": { minimumLevel: 60, maximumLevel: 60 },
  // TBC Dungeons
  'Hellfire Ramparts': { minimumLevel: 60, maximumLevel: 62 },
  'The Blood Furnace': { minimumLevel: 61, maximumLevel: 63 },
  'The Slave Pens': { minimumLevel: 62, maximumLevel: 64 },
  'The Underbog': { minimumLevel: 63, maximumLevel: 65 },
  'Mana-Tombs': { minimumLevel: 64, maximumLevel: 66 },
  'Auchenai Crypts': { minimumLevel: 65, maximumLevel: 67 },
  'Old Hillsbrad Foothills': { minimumLevel: 66, maximumLevel: 68 },
  'Sethekk Halls': { minimumLevel: 67, maximumLevel: 69 },
  'The Steamvault': { minimumLevel: 68, maximumLevel: 70 },
  'Shadow Labyrinth': { minimumLevel: 69, maximumLevel: 70 },
  'The Shattered Halls': { minimumLevel: 69, maximumLevel: 70 },
  'The Mechanar': { minimumLevel: 69, maximumLevel: 70 },
  'The Botanica': { minimumLevel: 69, maximumLevel: 70 },
  'The Arcatraz': { minimumLevel: 69, maximumLevel: 70 },
  'The Black Morass': { minimumLevel: 69, maximumLevel: 70 },
  "Magisters' Terrace": { minimumLevel: 70, maximumLevel: 70 },
  // TBC Raids
  Karazhan: { minimumLevel: 70, maximumLevel: 70 },
  "Gruul's Lair": { minimumLevel: 70, maximumLevel: 70 },
  "Magtheridon's Lair": { minimumLevel: 70, maximumLevel: 70 },
  'Serpentshrine Cavern': { minimumLevel: 70, maximumLevel: 70 },
  'The Eye': { minimumLevel: 70, maximumLevel: 70 },
  'Hyjal Summit': { minimumLevel: 70, maximumLevel: 70 },
  'Black Temple': { minimumLevel: 70, maximumLevel: 70 },
  "Zul'Aman": { minimumLevel: 70, maximumLevel: 70 },
  'Sunwell Plateau': { minimumLevel: 70, maximumLevel: 70 },
  // WotLK Dungeons
  'Utgarde Keep': { minimumLevel: 69, maximumLevel: 72 },
  'The Nexus': { minimumLevel: 71, maximumLevel: 73 },
  'Azjol-Nerub': { minimumLevel: 72, maximumLevel: 74 },
  "Ahn'kahet: The Old Kingdom": { minimumLevel: 73, maximumLevel: 75 },
  "Drak'Tharon Keep": { minimumLevel: 74, maximumLevel: 76 },
  'The Violet Hold': { minimumLevel: 75, maximumLevel: 77 },
  Gundrak: { minimumLevel: 76, maximumLevel: 78 },
  'Halls of Stone': { minimumLevel: 77, maximumLevel: 79 },
  'Halls of Lightning': { minimumLevel: 78, maximumLevel: 80 },
  'The Oculus': { minimumLevel: 78, maximumLevel: 80 },
  'The Culling of Stratholme': { minimumLevel: 78, maximumLevel: 80 },
  'Utgarde Pinnacle': { minimumLevel: 78, maximumLevel: 80 },
  'Trial of the Champion': { minimumLevel: 80, maximumLevel: 80 },
  'The Forge of Souls': { minimumLevel: 80, maximumLevel: 80 },
  'Pit of Saron': { minimumLevel: 80, maximumLevel: 80 },
  'Halls of Reflection': { minimumLevel: 80, maximumLevel: 80 },
  // WotLK Raids
  Naxxramas: { minimumLevel: 80, maximumLevel: 80 },
  'The Obsidian Sanctum': { minimumLevel: 80, maximumLevel: 80 },
  'The Eye of Eternity': { minimumLevel: 80, maximumLevel: 80 },
  'Vault of Archavon': { minimumLevel: 80, maximumLevel: 80 },
  Ulduar: { minimumLevel: 80, maximumLevel: 80 },
  'Trial of the Crusader': { minimumLevel: 80, maximumLevel: 80 },
  'Icecrown Citadel': { minimumLevel: 80, maximumLevel: 80 },
  'Ruby Sanctum': { minimumLevel: 80, maximumLevel: 80 },
  // Cataclysm Dungeons
  'Blackrock Caverns': { minimumLevel: 80, maximumLevel: 83 },
  'Throne of the Tides': { minimumLevel: 80, maximumLevel: 83 },
  'The Stonecore': { minimumLevel: 81, maximumLevel: 84 },
  'The Vortex Pinnacle': { minimumLevel: 82, maximumLevel: 84 },
  "Lost City of the Tol'vir": { minimumLevel: 83, maximumLevel: 85 },
  'Halls of Origination': { minimumLevel: 83, maximumLevel: 85 },
  'Grim Batol': { minimumLevel: 84, maximumLevel: 85 },
  "Zul'Gurub": { minimumLevel: 85, maximumLevel: 85 },
  'End Time': { minimumLevel: 85, maximumLevel: 85 },
  'Well of Eternity': { minimumLevel: 85, maximumLevel: 85 },
  'Hour of Twilight': { minimumLevel: 85, maximumLevel: 85 },
  // Cataclysm Raids
  'Blackwing Descent': { minimumLevel: 85, maximumLevel: 85 },
  'Bastion of Twilight': { minimumLevel: 85, maximumLevel: 85 },
  'Throne of the Four Winds': { minimumLevel: 85, maximumLevel: 85 },
  'Baradin Hold': { minimumLevel: 85, maximumLevel: 85 },
  Firelands: { minimumLevel: 85, maximumLevel: 85 },
  'Dragon Soul': { minimumLevel: 85, maximumLevel: 85 },
};

interface InstanceListCache {
  dungeons: WowInstance[];
  raids: WowInstance[];
  expiresAt: number;
}

interface InstanceDetailCache {
  detail: WowInstanceDetail;
  expiresAt: number;
}

@Injectable()
export class BlizzardService {
  private readonly logger = new Logger(BlizzardService.name);
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private tokenFetchPromise: Promise<string> | null = null;
  private realmCache = new Map<string, RealmCache>();
  private instanceListCache = new Map<string, InstanceListCache>();
  private instanceDetailCache = new Map<string, InstanceDetailCache>();

  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Clear cached token when Blizzard config updates.
   */
  @OnEvent(SETTINGS_EVENTS.BLIZZARD_UPDATED)
  handleBlizzardConfigUpdate() {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.tokenFetchPromise = null;
    this.logger.log('Blizzard config updated — cached token cleared');
  }

  /**
   * Normalize realm name for Blizzard API slug format.
   * "Area 52" → "area-52", "Mal'Ganis" → "malganis"
   */
  normalizeRealmSlug(realm: string): string {
    return realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-').trim();
  }

  /**
   * Map a WoW spec name to a role.
   */
  specToRole(spec: string): 'tank' | 'healer' | 'dps' | null {
    return SPEC_ROLE_MAP[spec] ?? null;
  }

  /**
   * Fetch a WoW character profile from the Blizzard API.
   * Calls Profile Summary, Character Media, and Equipment Summary endpoints.
   */
  async fetchCharacterProfile(
    name: string,
    realm: string,
    region: string,
    gameVariant: WowGameVariant = 'retail',
  ): Promise<BlizzardCharacterProfile> {
    const token = await this.getAccessToken(region);
    const realmSlug = this.normalizeRealmSlug(realm);
    const charName = name.toLowerCase();
    const { profile: profilePrefix } = getNamespacePrefixes(gameVariant);
    const namespace = `${profilePrefix}-${region}`;
    const baseUrl = `https://${region}.api.blizzard.com`;

    // Fetch profile summary
    const profileUrl = `${baseUrl}/profile/wow/character/${realmSlug}/${charName}`;
    const profileRes = await fetch(
      `${profileUrl}?namespace=${namespace}&locale=en_US`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!profileRes.ok) {
      const text = await profileRes.text();
      this.logger.error(
        `Blizzard profile API error: ${profileRes.status} ${text}`,
      );
      if (profileRes.status === 404) {
        throw new NotFoundException(
          `Character "${name}" not found on ${realm} (${region.toUpperCase()}). Check the spelling and realm.`,
        );
      }
      throw new Error(
        `Blizzard API error (${profileRes.status}). Please try again later.`,
      );
    }

    const profile = (await profileRes.json()) as {
      name: string;
      level: number;
      character_class: { name: string };
      active_spec?: { name: string };
      race: { name: string };
      faction: { type: string };
      realm: { name: string };
      equipped_item_level?: number;
    };

    // Fetch character media (avatar + full render) — non-fatal if it fails
    let avatarUrl: string | null = null;
    let renderUrl: string | null = null;
    try {
      const mediaRes = await fetch(
        `${profileUrl}/character-media?namespace=${namespace}&locale=en_US`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (mediaRes.ok) {
        const media = (await mediaRes.json()) as {
          assets?: Array<{ key: string; value: string }>;
        };
        const avatar = media.assets?.find(
          (a) => a.key === 'avatar' || a.key === 'inset',
        );
        avatarUrl = avatar?.value ?? null;
        const mainRaw =
          media.assets?.find((a) => a.key === 'main-raw') ??
          media.assets?.find((a) => a.key === 'main');
        renderUrl = mainRaw?.value ?? null;
        if (!renderUrl && media.assets?.length) {
          this.logger.log(
            `No render for ${charName}: available media keys = [${media.assets.map((a) => a.key).join(', ')}]`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch character media: ${err}`);
    }

    // Fetch equipment summary for item level — non-fatal if it fails
    let itemLevel: number | null = profile.equipped_item_level ?? null;
    if (itemLevel === null || itemLevel === undefined) {
      try {
        const equipRes = await fetch(
          `${profileUrl}/equipment?namespace=${namespace}&locale=en_US`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (equipRes.ok) {
          const equip = (await equipRes.json()) as {
            equipped_item_level?: number;
          };
          itemLevel = equip.equipped_item_level ?? null;
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch equipment summary: ${err}`);
      }
    }

    const specName = profile.active_spec?.name ?? null;
    const faction = profile.faction.type.toLowerCase() as 'alliance' | 'horde';

    return {
      name: profile.name,
      realm: profile.realm.name,
      class: profile.character_class.name,
      spec: specName,
      role: specName ? this.specToRole(specName) : null,
      level: profile.level,
      race: profile.race.name,
      faction,
      itemLevel,
      avatarUrl,
      renderUrl,
      profileUrl:
        gameVariant === 'retail'
          ? `https://worldofwarcraft.blizzard.com/en-${region}/character/${realmSlug}/${charName}`
          : null,
    };
  }

  /**
   * Fetch a WoW character's equipped items from the Blizzard API.
   * Returns null on failure (non-fatal).
   */
  async fetchCharacterEquipment(
    name: string,
    realm: string,
    region: string,
    gameVariant: WowGameVariant = 'retail',
  ): Promise<BlizzardCharacterEquipment | null> {
    try {
      const token = await this.getAccessToken(region);
      const realmSlug = this.normalizeRealmSlug(realm);
      const charName = name.toLowerCase();
      const { profile: profilePrefix } = getNamespacePrefixes(gameVariant);
      const namespace = `${profilePrefix}-${region}`;
      const baseUrl = `https://${region}.api.blizzard.com`;

      const url = `${baseUrl}/profile/wow/character/${realmSlug}/${charName}/equipment?namespace=${namespace}&locale=en_US`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        this.logger.warn(
          `Equipment fetch failed for ${charName}-${realmSlug}: ${res.status}`,
        );
        return null;
      }

      const data = (await res.json()) as {
        equipped_item_level?: number;
        equipped_items?: Array<{
          slot: { type: string };
          item: { id: number };
          name: string;
          quality: { type: string };
          level: { value: number };
          item_subclass?: { name: string };
          media?: { key?: { href: string } };
          enchantments?: Array<{
            display_string: string;
            enchantment_id?: number;
          }>;
          sockets?: Array<{
            socket_type: { type: string };
            item?: { id: number };
          }>;
          stats?: Array<{
            type: { type: string; name: string };
            value: number;
          }>;
          armor?: { value: number };
          binding?: { type: string };
          requirements?: { level?: { value: number } };
          weapon?: {
            damage: { min_value: number; max_value: number };
            attack_speed: { value: number };
            dps: { value: number };
          };
          description?: string;
          set?: { item_set?: { name: string } };
        }>;
      };

      const rawItems = (data.equipped_items ?? []).filter(
        (item) => item?.slot?.type && item?.item?.id,
      );

      // Batch-fetch item icon URLs in parallel (non-fatal per item)
      const iconUrls = await this.fetchItemIconUrls(
        rawItems
          .map((item) => ({
            itemId: item.item.id,
            mediaHref: item.media?.key?.href,
          }))
          .filter((entry) => entry.mediaHref) as Array<{
          itemId: number;
          mediaHref: string;
        }>,
        token,
      );

      const items: BlizzardEquipmentItem[] = rawItems.map((item) => ({
        slot: item.slot.type,
        name: item.name ?? 'Unknown',
        itemId: item.item.id,
        quality: (item.quality?.type ?? 'COMMON').toUpperCase(),
        itemLevel: item.level?.value ?? 0,
        itemSubclass: item.item_subclass?.name ?? null,
        enchantments: item.enchantments?.map((e) => ({
          displayString: e.display_string,
          enchantmentId: e.enchantment_id,
        })),
        sockets: item.sockets?.map((s) => ({
          socketType: s.socket_type?.type ?? 'UNKNOWN',
          itemId: s.item?.id,
        })),
        stats: item.stats?.map((s) => ({
          type: s.type.type,
          name: s.type.name,
          value: s.value,
        })),
        armor: item.armor?.value,
        binding: item.binding?.type,
        requiredLevel: item.requirements?.level?.value,
        weapon: item.weapon
          ? {
              damageMin: item.weapon.damage.min_value,
              damageMax: item.weapon.damage.max_value,
              attackSpeed: item.weapon.attack_speed.value,
              dps: item.weapon.dps.value,
            }
          : undefined,
        description: item.description,
        setName: item.set?.item_set?.name,
        iconUrl: iconUrls.get(item.item.id),
      }));

      // Log first few items' quality for debugging Classic API discrepancies
      if (items.length > 0) {
        const qualitySample = items
          .slice(0, 3)
          .map((i) => `${i.name}: quality=${i.quality}, iLvl=${i.itemLevel}`);
        this.logger.log(
          `Equipment for ${charName}: ${items.length} items. Sample: [${qualitySample.join('; ')}]`,
        );
      }

      return {
        equippedItemLevel: data.equipped_item_level ?? null,
        items,
        syncedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.warn(`Failed to fetch character equipment: ${err}`);
      return null;
    }
  }

  /**
   * Batch-fetch item icon URLs from Blizzard media endpoints.
   * Each item's media.key.href from the equipment response points to a media
   * endpoint that returns the icon CDN URL. Fetches all in parallel (non-fatal).
   *
   * The Blizzard CDN for Classic variants (classicann-us, etc.) returns 403 for
   * some icons, so we normalize all icon URLs to the retail CDN format which is
   * more reliable: https://render.worldofwarcraft.com/us/icons/56/{icon_name}.jpg
   */
  private async fetchItemIconUrls(
    items: Array<{ itemId: number; mediaHref: string }>,
    token: string,
  ): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (items.length === 0) return result;

    const fetches = items.map(async ({ itemId, mediaHref }) => {
      try {
        const res = await fetch(mediaHref, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const media = (await res.json()) as {
          assets?: Array<{ key: string; value: string }>;
        };
        const icon = media.assets?.find((a) => a.key === 'icon');
        if (icon?.value) {
          // Normalize to retail CDN — extract icon filename and use us/ base
          // e.g., ".../classicann-us/icons/56/inv_shoulder_08.jpg"
          //     → ".../us/icons/56/inv_shoulder_08.jpg"
          const iconMatch = icon.value.match(/icons\/\d+\/(.+)$/);
          const normalizedUrl = iconMatch
            ? `https://render.worldofwarcraft.com/us/icons/56/${iconMatch[1]}`
            : icon.value;
          result.set(itemId, normalizedUrl);
        }
      } catch {
        // Non-fatal: item will just not have an icon
      }
    });

    await Promise.all(fetches);
    return result;
  }

  /**
   * Infer a character's specialization from the Blizzard specializations endpoint.
   * For retail: uses active_specialization directly.
   * For Classic: finds the talent tree with the most points invested and
   * maps it to a spec name and role.
   * Returns null fields if the endpoint is unavailable or the character has no talents.
   */
  async fetchCharacterSpecializations(
    name: string,
    realm: string,
    region: string,
    characterClass: string,
    gameVariant: WowGameVariant = 'retail',
  ): Promise<InferredSpecialization> {
    try {
      const token = await this.getAccessToken(region);
      const realmSlug = this.normalizeRealmSlug(realm);
      const charName = name.toLowerCase();
      const { profile: profilePrefix } = getNamespacePrefixes(gameVariant);
      const namespace = `${profilePrefix}-${region}`;
      const baseUrl = `https://${region}.api.blizzard.com`;

      const url = `${baseUrl}/profile/wow/character/${realmSlug}/${charName}/specializations?namespace=${namespace}&locale=en_US`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        this.logger.debug(
          `Specializations endpoint returned ${res.status} for ${charName}-${realmSlug}`,
        );
        return { spec: null, role: null };
      }

      const data = (await res.json()) as {
        // Retail format
        active_specialization?: { name: string };
        // Classic format — array of talent trees with spent point counts
        specializations?: Array<{
          specialization_name?: string;
          spent_points?: number;
          talents?: Array<unknown>;
        }>;
        // Some variants return specialization_groups
        specialization_groups?: Array<{
          specializations?: Array<{
            specialization_name?: string;
            spent_points?: number;
            talents?: Array<unknown>;
          }>;
        }>;
      };

      // Retail: if active_specialization is present, use it directly
      if (data.active_specialization?.name) {
        const specName = data.active_specialization.name;
        return {
          spec: specName,
          role: this.specToRole(specName),
        };
      }

      // Classic: find the talent tree with the most points
      const trees =
        data.specializations ??
        data.specialization_groups?.[0]?.specializations ??
        [];

      if (trees.length === 0) {
        return { spec: null, role: null };
      }

      // Find tree with most spent points
      let bestTree: { name: string; points: number } | null = null;
      for (const tree of trees) {
        const treeName = tree.specialization_name;
        const points = tree.spent_points ?? tree.talents?.length ?? 0;
        if (treeName && (!bestTree || points > bestTree.points)) {
          bestTree = { name: treeName, points };
        }
      }

      if (!bestTree || bestTree.points === 0) {
        return { spec: null, role: null };
      }

      // Map tree name to role using class-specific lookup
      const classRoles = CLASSIC_TALENT_TREE_ROLES[characterClass];
      const role =
        classRoles?.[bestTree.name] ?? this.specToRole(bestTree.name);

      this.logger.log(
        `Inferred spec for ${charName}: ${bestTree.name} (${bestTree.points} pts) → ${role ?? 'unknown'}`,
      );

      return {
        spec: bestTree.name,
        role,
      };
    } catch (err) {
      this.logger.debug(`Failed to fetch specializations: ${err}`);
      return { spec: null, role: null };
    }
  }

  /**
   * Fetch the list of WoW realms for a region.
   * Results are cached in memory for 1 hour since realms rarely change.
   */
  async fetchRealmList(
    region: string,
    gameVariant: WowGameVariant = 'retail',
  ): Promise<WowRealm[]> {
    const cacheKey = `${region}:${gameVariant}`;
    const cached = this.realmCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.realms;
    }

    const token = await this.getAccessToken(region);
    const { dynamic: dynamicPrefix } = getNamespacePrefixes(gameVariant);
    const url = `https://${region}.api.blizzard.com/data/wow/realm/index?namespace=${dynamicPrefix}-${region}&locale=en_US`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(
        `Blizzard realm index error: ${response.status} ${text}`,
      );
      throw new Error(`Failed to fetch realm list (${response.status})`);
    }

    const data = (await response.json()) as {
      realms: Array<{ name: string; slug: string; id: number }>;
    };

    const realms: WowRealm[] = data.realms
      .map((r) => ({ name: r.name, slug: r.slug, id: r.id }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.realmCache.set(cacheKey, {
      realms,
      expiresAt: Date.now() + REALM_CACHE_TTL,
    });

    this.logger.log(`Cached ${realms.length} realms for ${cacheKey}`);
    return realms;
  }

  /**
   * Fetch all dungeon and raid instances for a WoW variant.
   * Orchestrates: expansion index → parallel expansion details → merged flat lists.
   * Results are cached in memory for 24 hours.
   */
  async fetchAllInstances(
    region: string,
    gameVariant: WowGameVariant = 'retail',
  ): Promise<{ dungeons: WowInstance[]; raids: WowInstance[] }> {
    const cacheKey = `${region}:${gameVariant}`;
    const cached = this.instanceListCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return { dungeons: cached.dungeons, raids: cached.raids };
    }

    const token = await this.getAccessToken(region);
    // Journal API only exists in the retail static namespace — Classic variants
    // don't have their own journal endpoints, so we always use retail static
    // and filter by expansion name for Classic variants.
    const namespace = `static-${region}`;
    const baseUrl = `https://${region}.api.blizzard.com`;

    // Step 1: Fetch expansion index
    const indexUrl = `${baseUrl}/data/wow/journal-expansion/index?namespace=${namespace}&locale=en_US`;
    const indexRes = await fetch(indexUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!indexRes.ok) {
      const text = await indexRes.text();
      this.logger.error(
        `Blizzard journal expansion index error: ${indexRes.status} ${text}`,
      );
      throw new Error(`Failed to fetch expansion index (${indexRes.status})`);
    }

    const indexData = (await indexRes.json()) as {
      tiers: Array<{ id: number; name: string }>;
    };

    // Step 2: Parallel-fetch all expansion details
    const expansionDetails = await Promise.all(
      indexData.tiers.map(async (tier) => {
        try {
          const detailUrl = `${baseUrl}/data/wow/journal-expansion/${tier.id}?namespace=${namespace}&locale=en_US`;
          const detailRes = await fetch(detailUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!detailRes.ok) return null;
          const detail = (await detailRes.json()) as {
            name: string;
            dungeons?: Array<{ id: number; name: string }>;
            raids?: Array<{ id: number; name: string }>;
          };
          return { expansionName: detail.name ?? tier.name, detail };
        } catch {
          return null;
        }
      }),
    );

    // Step 3: Merge into flat lists
    let dungeons: WowInstance[] = [];
    let raids: WowInstance[] = [];

    for (const result of expansionDetails) {
      if (!result) continue;
      const { expansionName, detail } = result;
      if (detail.dungeons) {
        for (const d of detail.dungeons) {
          dungeons.push({ id: d.id, name: d.name, expansion: expansionName });
        }
      }
      if (detail.raids) {
        for (const r of detail.raids) {
          raids.push({ id: r.id, name: r.name, expansion: expansionName });
        }
      }
    }

    // Step 4: Filter by expansion for Classic variants (journal data is always
    // fetched from retail static namespace since Classic doesn't have journal endpoints)
    if (gameVariant === 'classic_era') {
      // Classic Era = vanilla only
      const classicExpansions = new Set(['Classic']);
      dungeons = dungeons.filter((d) => classicExpansions.has(d.expansion));
      raids = raids.filter((r) => classicExpansions.has(r.expansion));
    } else if (
      gameVariant === 'classic' ||
      gameVariant === 'classic_anniversary'
    ) {
      // WoW Classic (Cataclysm Classic currently) includes vanilla through Cata
      const classicExpansions = new Set([
        'Classic',
        'Burning Crusade',
        'Wrath of the Lich King',
        'Cataclysm',
      ]);
      dungeons = dungeons.filter((d) => classicExpansions.has(d.expansion));
      raids = raids.filter((r) => classicExpansions.has(r.expansion));
    }

    // Step 5: Deduplicate by ID (e.g., Deadmines/SFK appear in both Classic and Cata)
    // Keep the first occurrence (Classic expansion entry) over later ones
    dungeons = this.deduplicateById(dungeons);
    raids = this.deduplicateById(raids);

    // Step 6: Expand complex dungeons into sub-instances for Classic variants
    // (e.g., Scarlet Monastery → SM:GY, SM:Lib, SM:Arm, SM:Cath)
    if (gameVariant !== 'retail') {
      dungeons = this.expandSubInstances(dungeons);
      raids = this.expandSubInstances(raids);
    }

    // Step 7: Add short names and accurate Classic level data for all instances
    const enrichInstance = (inst: WowInstance): WowInstance => {
      const levels =
        gameVariant !== 'retail'
          ? CLASSIC_INSTANCE_LEVELS[inst.name]
          : undefined;
      return {
        ...inst,
        shortName: inst.shortName ?? getShortName(inst.name),
        minimumLevel: inst.minimumLevel ?? levels?.minimumLevel ?? null,
        maximumLevel: inst.maximumLevel ?? levels?.maximumLevel ?? null,
      };
    };
    dungeons = dungeons.map(enrichInstance);
    raids = raids.map(enrichInstance);

    this.instanceListCache.set(cacheKey, {
      dungeons,
      raids,
      expiresAt: Date.now() + INSTANCE_CACHE_TTL,
    });

    this.logger.debug(
      `Cached ${dungeons.length} dungeons + ${raids.length} raids for ${cacheKey}`,
    );
    return { dungeons, raids };
  }

  /**
   * Expand instances that have known sub-instances (e.g., Scarlet Monastery → 4 wings).
   * Replaces the parent entry with individual wing entries, each with its own ID and level range.
   */
  private expandSubInstances(instances: WowInstance[]): WowInstance[] {
    const result: WowInstance[] = [];
    for (const inst of instances) {
      const subs = CLASSIC_SUB_INSTANCES[inst.name];
      if (subs) {
        for (const sub of subs) {
          result.push({
            id: inst.id * 100 + sub.idSuffix,
            name: sub.name,
            shortName: sub.shortName,
            expansion: inst.expansion,
            minimumLevel: sub.minimumLevel,
            maximumLevel: sub.maximumLevel,
          });
        }
      } else {
        result.push(inst);
      }
    }
    return result;
  }

  /** Deduplicate instances by ID, keeping the first occurrence */
  private deduplicateById(instances: WowInstance[]): WowInstance[] {
    const seen = new Set<number>();
    return instances.filter((inst) => {
      if (seen.has(inst.id)) return false;
      seen.add(inst.id);
      return true;
    });
  }

  /**
   * Fetch detail for a specific instance (level requirements, player count).
   * Results are cached individually for 24 hours.
   */
  async fetchInstanceDetail(
    instanceId: number,
    region: string,
    gameVariant: WowGameVariant = 'retail',
  ): Promise<WowInstanceDetail> {
    const cacheKey = `${region}:${gameVariant}:${instanceId}`;
    const cached = this.instanceDetailCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.detail;
    }

    // Synthetic IDs (from sub-instance expansion) are > 10000 — return hardcoded data
    if (instanceId > 10000) {
      const parentId = Math.floor(instanceId / 100);
      const suffix = instanceId % 100;
      for (const [parentName, subs] of Object.entries(CLASSIC_SUB_INSTANCES)) {
        for (const sub of subs) {
          if (sub.idSuffix === suffix) {
            // Verify it matches a known parent by checking if any cached list has this parent
            const detail: WowInstanceDetail = {
              id: instanceId,
              name: sub.name,
              shortName: sub.shortName,
              expansion: 'Classic',
              minimumLevel: sub.minimumLevel,
              maximumLevel: sub.maximumLevel,
              maxPlayers: 5,
              category: 'dungeon',
            };
            this.instanceDetailCache.set(cacheKey, {
              detail,
              expiresAt: Date.now() + INSTANCE_CACHE_TTL,
            });
            this.logger.debug(
              `Resolved synthetic instance ${instanceId} → ${parentName} / ${sub.name}`,
            );
            return detail;
          }
        }
      }
      // Unknown synthetic ID — fall through to Blizzard API with parent ID
      this.logger.warn(
        `Unknown synthetic instance ID ${instanceId}, trying parent ${parentId}`,
      );
    }

    const token = await this.getAccessToken(region);
    // Journal API only exists in the retail static namespace
    const namespace = `static-${region}`;
    const baseUrl = `https://${region}.api.blizzard.com`;

    const url = `${baseUrl}/data/wow/journal-instance/${instanceId}?namespace=${namespace}&locale=en_US`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(
        `Blizzard journal instance detail error: ${res.status} ${text}`,
      );
      throw new Error(`Failed to fetch instance detail (${res.status})`);
    }

    const data = (await res.json()) as {
      id: number;
      name: string;
      minimum_level?: number;
      modes?: Array<{
        mode: { type: string; name: string };
        players: number;
      }>;
      category?: { type: string };
      expansion?: { name: string };
    };

    const maxPlayers = data.modes?.length
      ? Math.max(...data.modes.map((m) => m.players))
      : null;

    const categoryType = data.category?.type?.toLowerCase();
    const category: 'dungeon' | 'raid' =
      categoryType === 'raid' ? 'raid' : 'dungeon';

    // Override with accurate Classic level data when available
    const levelOverride =
      gameVariant !== 'retail' ? CLASSIC_INSTANCE_LEVELS[data.name] : undefined;

    const detail: WowInstanceDetail = {
      id: data.id,
      name: data.name,
      shortName: getShortName(data.name),
      expansion: data.expansion?.name ?? 'Unknown',
      minimumLevel: levelOverride?.minimumLevel ?? data.minimum_level ?? null,
      maximumLevel: levelOverride?.maximumLevel ?? null,
      maxPlayers,
      category,
    };

    this.instanceDetailCache.set(cacheKey, {
      detail,
      expiresAt: Date.now() + INSTANCE_CACHE_TTL,
    });

    return detail;
  }

  /**
   * Get OAuth2 access token from Blizzard.
   * Uses single-flight pattern (same as IGDB service).
   */
  private async getAccessToken(region: string): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (this.tokenFetchPromise) {
      return this.tokenFetchPromise;
    }

    this.tokenFetchPromise = this.fetchNewToken(region);

    try {
      const token = await this.tokenFetchPromise;
      return token;
    } finally {
      this.tokenFetchPromise = null;
    }
  }

  private async fetchNewToken(region: string): Promise<string> {
    const config = await this.settingsService.getBlizzardConfig();
    if (!config) {
      throw new Error('Blizzard API credentials not configured');
    }

    const response = await fetch(`https://${region}.battle.net/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }),
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

    this.logger.debug('Blizzard access token refreshed');
    return this.accessToken;
  }
}
