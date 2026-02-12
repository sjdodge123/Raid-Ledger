/**
 * Demo Data Generator (ROK-233)
 *
 * Deterministic data generator using seeded PRNG (mulberry32).
 * Repeated installs produce identical data for reproducible demos.
 */

// ─── Seeded PRNG ─────────────────────────────────────────────────────────────

const DEFAULT_SEED = 0xdeadbeef;

/** mulberry32 — fast 32-bit seeded PRNG */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function createRng(seed = DEFAULT_SEED): Rng {
  return mulberry32(seed);
}

// ─── PRNG Helpers ────────────────────────────────────────────────────────────

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick() called on empty array');
  return arr[Math.floor(rng() * arr.length)];
}

export function pickN<T>(rng: Rng, arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  shuffle(rng, copy);
  return copy.slice(0, Math.min(n, copy.length));
}

export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function weightedPick<T>(
  rng: Rng,
  items: readonly T[],
  weights: readonly number[],
): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ─── Data Pools ──────────────────────────────────────────────────────────────

const USERNAME_PREFIXES = [
  'Shadow',
  'Dark',
  'Storm',
  'Ice',
  'Fire',
  'Crystal',
  'Iron',
  'Steel',
  'Moon',
  'Sun',
  'Blood',
  'Void',
  'Nether',
  'Frost',
  'Thunder',
  'Doom',
  'Star',
  'Wolf',
  'Raven',
  'Ghost',
  'Night',
  'Chaos',
  'Arcane',
  'Nova',
  'Blaze',
  'Ash',
  'Venom',
  'Hex',
  'Crimson',
  'Azure',
] as const;

const USERNAME_SUFFIXES = [
  'Blade',
  'Fury',
  'Strike',
  'Fang',
  'Claw',
  'Bane',
  'Heart',
  'Soul',
  'Wind',
  'Storm',
  'Hawk',
  'Wolf',
  'Mage',
  'Knight',
  'Hunter',
  'Slayer',
  'Walker',
  'Caller',
  'Weaver',
  'Singer',
  'Guard',
  'Reaper',
  'Breaker',
  'Dancer',
  'Seeker',
  'Warden',
  'Keeper',
  'Rider',
  'Sage',
  'Forge',
] as const;

const AVATAR_CHARS = '0123456789abcdef';

function generateAvatar(rng: Rng): string {
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += AVATAR_CHARS[Math.floor(rng() * AVATAR_CHARS.length)];
  }
  return result;
}

// ─── WoW Classes ─────────────────────────────────────────────────────────────

export interface WowClassDef {
  class: string;
  specs: { name: string; role: 'tank' | 'healer' | 'dps' }[];
  wowClass: string;
}

export const WOW_CLASSES: WowClassDef[] = [
  {
    class: 'Warrior',
    specs: [
      { name: 'Arms', role: 'dps' },
      { name: 'Fury', role: 'dps' },
      { name: 'Protection', role: 'tank' },
    ],
    wowClass: 'warrior',
  },
  {
    class: 'Paladin',
    specs: [
      { name: 'Holy', role: 'healer' },
      { name: 'Protection', role: 'tank' },
      { name: 'Retribution', role: 'dps' },
    ],
    wowClass: 'paladin',
  },
  {
    class: 'Hunter',
    specs: [
      { name: 'Beast Mastery', role: 'dps' },
      { name: 'Marksmanship', role: 'dps' },
      { name: 'Survival', role: 'dps' },
    ],
    wowClass: 'hunter',
  },
  {
    class: 'Rogue',
    specs: [
      { name: 'Assassination', role: 'dps' },
      { name: 'Outlaw', role: 'dps' },
      { name: 'Subtlety', role: 'dps' },
    ],
    wowClass: 'rogue',
  },
  {
    class: 'Priest',
    specs: [
      { name: 'Discipline', role: 'healer' },
      { name: 'Holy', role: 'healer' },
      { name: 'Shadow', role: 'dps' },
    ],
    wowClass: 'priest',
  },
  {
    class: 'Shaman',
    specs: [
      { name: 'Elemental', role: 'dps' },
      { name: 'Enhancement', role: 'dps' },
      { name: 'Restoration', role: 'healer' },
    ],
    wowClass: 'shaman',
  },
  {
    class: 'Mage',
    specs: [
      { name: 'Arcane', role: 'dps' },
      { name: 'Fire', role: 'dps' },
      { name: 'Frost', role: 'dps' },
    ],
    wowClass: 'mage',
  },
  {
    class: 'Warlock',
    specs: [
      { name: 'Affliction', role: 'dps' },
      { name: 'Demonology', role: 'dps' },
      { name: 'Destruction', role: 'dps' },
    ],
    wowClass: 'warlock',
  },
  {
    class: 'Monk',
    specs: [
      { name: 'Brewmaster', role: 'tank' },
      { name: 'Mistweaver', role: 'healer' },
      { name: 'Windwalker', role: 'dps' },
    ],
    wowClass: 'monk',
  },
  {
    class: 'Druid',
    specs: [
      { name: 'Balance', role: 'dps' },
      { name: 'Feral', role: 'dps' },
      { name: 'Guardian', role: 'tank' },
      { name: 'Restoration', role: 'healer' },
    ],
    wowClass: 'druid',
  },
  {
    class: 'Demon Hunter',
    specs: [
      { name: 'Havoc', role: 'dps' },
      { name: 'Vengeance', role: 'tank' },
    ],
    wowClass: 'demonhunter',
  },
  {
    class: 'Death Knight',
    specs: [
      { name: 'Blood', role: 'tank' },
      { name: 'Frost', role: 'dps' },
      { name: 'Unholy', role: 'dps' },
    ],
    wowClass: 'deathknight',
  },
  {
    class: 'Evoker',
    specs: [
      { name: 'Devastation', role: 'dps' },
      { name: 'Preservation', role: 'healer' },
      { name: 'Augmentation', role: 'dps' },
    ],
    wowClass: 'evoker',
  },
];

// ─── FFXIV Jobs ──────────────────────────────────────────────────────────────

export interface FfxivJobDef {
  class: string;
  role: 'tank' | 'healer' | 'dps';
}

export const FFXIV_JOBS: FfxivJobDef[] = [
  { class: 'Paladin', role: 'tank' },
  { class: 'Warrior', role: 'tank' },
  { class: 'Dark Knight', role: 'tank' },
  { class: 'Gunbreaker', role: 'tank' },
  { class: 'White Mage', role: 'healer' },
  { class: 'Scholar', role: 'healer' },
  { class: 'Astrologian', role: 'healer' },
  { class: 'Sage', role: 'healer' },
  { class: 'Monk', role: 'dps' },
  { class: 'Dragoon', role: 'dps' },
  { class: 'Ninja', role: 'dps' },
  { class: 'Samurai', role: 'dps' },
  { class: 'Reaper', role: 'dps' },
  { class: 'Bard', role: 'dps' },
  { class: 'Machinist', role: 'dps' },
  { class: 'Dancer', role: 'dps' },
  { class: 'Black Mage', role: 'dps' },
  { class: 'Summoner', role: 'dps' },
  { class: 'Red Mage', role: 'dps' },
];

// ─── IGDB Game Weights ───────────────────────────────────────────────────────

export interface IgdbGameWeight {
  igdbId: string;
  name: string;
  weight: number;
}

export const IGDB_GAME_WEIGHTS: IgdbGameWeight[] = [
  { igdbId: '123', name: 'World of Warcraft', weight: 8 },
  { igdbId: '14729', name: 'Final Fantasy XIV Online', weight: 6 },
  { igdbId: '25657', name: 'Destiny 2', weight: 5 },
  { igdbId: '104967', name: 'Valheim', weight: 4 },
  { igdbId: '136210', name: 'World of Warcraft Classic', weight: 4 },
  { igdbId: '250616', name: 'Helldivers 2', weight: 4 },
  { igdbId: '27134', name: 'Deep Rock Galactic', weight: 3 },
  { igdbId: '125165', name: 'Diablo IV', weight: 3 },
  { igdbId: '1081', name: 'The Elder Scrolls Online', weight: 3 },
  { igdbId: '1183', name: 'Guild Wars 2', weight: 3 },
  { igdbId: '119171', name: "Baldur's Gate 3", weight: 3 },
  { igdbId: '36926', name: 'Monster Hunter: World', weight: 2 },
  { igdbId: '279661', name: 'Monster Hunter Wilds', weight: 2 },
  { igdbId: '2903', name: 'Warframe', weight: 2 },
  { igdbId: '3277', name: 'Rust', weight: 2 },
  { igdbId: '10239', name: 'ARK: Survival Evolved', weight: 2 },
  { igdbId: '11137', name: 'Sea of Thieves', weight: 2 },
  { igdbId: '119133', name: 'Elden Ring', weight: 2 },
  { igdbId: '1911', name: 'Path of Exile', weight: 2 },
  { igdbId: '151665', name: 'Palworld', weight: 2 },
  { igdbId: '16999', name: 'Conan Exiles', weight: 1 },
  { igdbId: '26128', name: 'Lost Ark', weight: 1 },
  { igdbId: '24654', name: 'New World', weight: 1 },
  { igdbId: '6292', name: 'Black Desert Online', weight: 1 },
  { igdbId: '117294', name: 'Throne and Liberty', weight: 1 },
  { igdbId: '5574', name: '7 Days to Die', weight: 1 },
  { igdbId: '90558', name: 'Satisfactory', weight: 1 },
  { igdbId: '272600', name: 'Soulmask', weight: 1 },
  { igdbId: '138950', name: 'Monster Hunter Rise', weight: 1 },
  { igdbId: '90099', name: "Tom Clancy's The Division 2", weight: 1 },
  { igdbId: '95118', name: 'Last Epoch', weight: 1 },
  { igdbId: '115', name: 'League of Legends', weight: 1 },
  { igdbId: '126459', name: 'VALORANT', weight: 1 },
  { igdbId: '114795', name: 'Apex Legends', weight: 1 },
  { igdbId: '125174', name: 'Overwatch 2', weight: 1 },
  { igdbId: '121', name: 'Minecraft', weight: 1 },
  { igdbId: '1905', name: 'Fortnite', weight: 1 },
  { igdbId: '11198', name: 'Rocket League', weight: 1 },
  { igdbId: '242408', name: 'Counter-Strike 2', weight: 1 },
  { igdbId: '1942', name: 'The Witcher 3: Wild Hunt', weight: 1 },
  { igdbId: '1020', name: 'Grand Theft Auto V', weight: 1 },
  { igdbId: '27789', name: 'PUBG: Battlegrounds', weight: 1 },
  { igdbId: '2963', name: 'DOTA 2', weight: 1 },
  { igdbId: '282566', name: 'Smite 2', weight: 1 },
  { igdbId: '18866', name: 'Dead by Daylight', weight: 1 },
  { igdbId: '28512', name: 'Risk of Rain 2', weight: 1 },
  { igdbId: '212089', name: 'Lethal Company', weight: 1 },
  { igdbId: '294661', name: 'Content Warning', weight: 1 },
  { igdbId: '132516', name: 'Phasmophobia', weight: 1 },
];

// ─── IGDB → Registry Slug Mapping ───────────────────────────────────────────

/** Maps IGDB game IDs to registry game slugs (single source of truth) */
export const IGDB_TO_REGISTRY_SLUG: Record<string, string> = {
  '123': 'wow',
  '136210': 'wow-classic',
  '14729': 'ffxiv',
  '104967': 'valheim',
};

// ─── Event Title Templates ───────────────────────────────────────────────────

interface EventTemplate {
  title: string;
  description: string;
}

const MMO_RAID_TEMPLATES: EventTemplate[] = [
  {
    title: 'Heroic Raid Night',
    description: 'Weekly heroic clear. All welcome!',
  },
  {
    title: 'Mythic Progression',
    description: 'Progression night — know the fights.',
  },
  {
    title: 'Normal Farm Run',
    description: 'Quick normal clear for gearing alts.',
  },
  { title: 'Alt Raid Night', description: 'Bring your alts, chill run.' },
  {
    title: 'Guild First Attempts',
    description: 'Pushing new content together.',
  },
  { title: 'Reclear Wednesday', description: 'Weekly reclear. Be on time!' },
];

const MMO_DUNGEON_TEMPLATES: EventTemplate[] = [
  {
    title: 'Mythic+ Push Night',
    description: 'High key pushing. Need all roles.',
  },
  {
    title: 'Weekly Dungeon Runs',
    description: 'Knocking out weekly dungeons.',
  },
  {
    title: 'Key Carry Night',
    description: 'Helping guildies with their keys.',
  },
  {
    title: 'Dungeon Speed Runs',
    description: 'Timed runs for bragging rights.',
  },
];

const SURVIVAL_TEMPLATES: EventTemplate[] = [
  { title: 'Boss Rush', description: 'Taking down all bosses in one session!' },
  {
    title: 'Base Building Session',
    description: 'Expanding and fortifying our base.',
  },
  {
    title: 'Exploration Party',
    description: 'Venturing into unknown territory.',
  },
  { title: 'Resource Gathering Run', description: 'Stocking up on materials.' },
  { title: 'New World Start', description: 'Fresh start on a new server.' },
];

const SHOOTER_TEMPLATES: EventTemplate[] = [
  { title: 'Raid Night', description: 'Weekly endgame content run.' },
  { title: 'PvP Tournament', description: 'In-guild tournament brackets.' },
  { title: 'Nightfall Grind', description: 'Grinding high-level content.' },
  {
    title: 'Competitive Scrims',
    description: 'Practice matches for ranked play.',
  },
  { title: 'Casual Game Night', description: 'Just having fun, no pressure.' },
];

const COOP_TEMPLATES: EventTemplate[] = [
  { title: 'Co-op Session', description: 'Jumping in together for some fun.' },
  { title: 'Campaign Night', description: 'Continuing the story together.' },
  { title: 'Challenge Mode', description: 'Tackling the hardest difficulty.' },
  { title: 'Game Night', description: 'Casual session, all skill levels.' },
];

const FFXIV_TEMPLATES: EventTemplate[] = [
  {
    title: 'Savage Prog',
    description: 'Savage progression — phase 2 onwards.',
  },
  { title: 'Extreme Trial Farm', description: 'Farming mounts and totems.' },
  {
    title: 'Alliance Raid Roulette',
    description: 'Running alliance raids together.',
  },
  { title: 'Map Night', description: 'Treasure map dungeon party!' },
  {
    title: 'Ultimate Prog',
    description: 'Ultimate fight progression. Dedication required.',
  },
];

// Map IGDB IDs to template categories
const MMO_IGDB_IDS = new Set([
  '123',
  '136210',
  '1183',
  '1081',
  '26128',
  '24654',
  '6292',
  '117294',
]);
const FFXIV_IGDB_IDS = new Set(['14729']);
const SURVIVAL_IGDB_IDS = new Set([
  '104967',
  '10239',
  '3277',
  '151665',
  '272600',
  '16999',
  '5574',
  '90558',
]);
const SHOOTER_IGDB_IDS = new Set([
  '25657',
  '250616',
  '2903',
  '90099',
  '126459',
  '114795',
  '125174',
  '1905',
  '242408',
  '27789',
]);

function getTemplatesForGame(igdbId: string): EventTemplate[] {
  if (FFXIV_IGDB_IDS.has(igdbId)) return FFXIV_TEMPLATES;
  if (MMO_IGDB_IDS.has(igdbId))
    return [...MMO_RAID_TEMPLATES, ...MMO_DUNGEON_TEMPLATES];
  if (SURVIVAL_IGDB_IDS.has(igdbId)) return SURVIVAL_TEMPLATES;
  if (SHOOTER_IGDB_IDS.has(igdbId)) return SHOOTER_TEMPLATES;
  return COOP_TEMPLATES;
}

// ─── Game Time Archetypes ────────────────────────────────────────────────────

interface GameTimeArchetype {
  name: string;
  weight: number;
  weekdaySlots: { start: number; end: number }[];
  weekendSlots: { start: number; end: number }[];
}

const ARCHETYPES: GameTimeArchetype[] = [
  {
    name: 'Hardcore',
    weight: 15,
    weekdaySlots: [{ start: 16, end: 0 }],
    weekendSlots: [
      { start: 10, end: 16 },
      { start: 18, end: 1 },
    ],
  },
  {
    name: 'Regular',
    weight: 40,
    weekdaySlots: [{ start: 19, end: 23 }],
    weekendSlots: [{ start: 14, end: 22 }],
  },
  {
    name: 'Casual',
    weight: 30,
    weekdaySlots: [{ start: 20, end: 22 }],
    weekendSlots: [{ start: 12, end: 18 }],
  },
  {
    name: 'NightOwl',
    weight: 15,
    weekdaySlots: [{ start: 22, end: 3 }],
    weekendSlots: [{ start: 21, end: 4 }],
  },
];

// ─── Generator Types ─────────────────────────────────────────────────────────

export interface GeneratedUser {
  username: string;
  avatar: string;
}

export interface GeneratedEvent {
  title: string;
  description: string;
  registryGameId: string | null;
  gameId: string;
  startTime: Date;
  endTime: Date;
  maxPlayers: number | null;
}

export interface GeneratedCharacter {
  username: string;
  registryGameSlug: string;
  charName: string;
  class: string;
  spec: string | null;
  role: 'tank' | 'healer' | 'dps';
  wowClass: string | null;
  isMain: boolean;
}

export interface GeneratedSignup {
  eventIdx: number;
  username: string;
  confirmationStatus: 'confirmed' | 'pending';
}

export interface GeneratedGameTime {
  username: string;
  dayOfWeek: number;
  startHour: number;
}

export interface GeneratedAvailability {
  username: string;
  start: Date;
  end: Date;
  status: 'available' | 'blocked';
}

export interface GeneratedNotification {
  username: string;
  type: string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
}

export interface GeneratedNotifPreference {
  username: string;
  channelPrefs: Record<string, Record<string, boolean>>;
}

export interface GeneratedGameInterest {
  username: string;
  igdbId: number;
}

// ─── Generator Functions ─────────────────────────────────────────────────────

export function generateUsernames(
  rng: Rng,
  count: number,
  existing: readonly string[],
): GeneratedUser[] {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const results: GeneratedUser[] = [];

  const prefixes = [...USERNAME_PREFIXES];
  const suffixes = [...USERNAME_SUFFIXES];
  shuffle(rng, prefixes);
  shuffle(rng, suffixes);

  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      if (results.length >= count) break;
      const name = `${prefix}${suffix}`;
      if (taken.has(name.toLowerCase())) continue;
      taken.add(name.toLowerCase());
      results.push({ username: name, avatar: generateAvatar(rng) });
    }
    if (results.length >= count) break;
  }

  // Fallback with numbers if we somehow need more
  let counter = 1;
  while (results.length < count) {
    const name = `Gamer${counter++}`;
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      results.push({ username: name, avatar: generateAvatar(rng) });
    }
  }

  return results;
}

export function generateEvents(
  rng: Rng,
  registryGames: { id: string; slug: string }[],
  baseTime: Date,
  playerCounts?: Map<string, number>,
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const gameIds = IGDB_GAME_WEIGHTS.map((g) => g.igdbId);
  const weights = IGDB_GAME_WEIGHTS.map((g) => g.weight);

  // Registry game slug → id mapping
  const registryBySlug = new Map(registryGames.map((g) => [g.slug, g.id]));

  const targetEvents = 70;

  // Phase 1: 1 event per game
  for (const gw of IGDB_GAME_WEIGHTS) {
    const templates = getTemplatesForGame(gw.igdbId);
    const tmpl = pick(rng, templates);
    const regSlug = IGDB_TO_REGISTRY_SLUG[gw.igdbId];
    const registryGameId = regSlug
      ? (registryBySlug.get(regSlug) ?? null)
      : null;

    const daysOffset = randInt(rng, -30, 60);
    const hour = randInt(rng, 17, 22);
    const duration = randInt(rng, 1, 4);
    const start = new Date(baseTime);
    start.setDate(start.getDate() + daysOffset);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + duration * 60 * 60 * 1000);

    events.push({
      title: `${tmpl.title} — ${gw.name}`,
      description: tmpl.description,
      registryGameId,
      gameId: gw.igdbId,
      startTime: start,
      endTime: end,
      maxPlayers: playerCounts?.get(gw.igdbId) ?? null,
    });
  }

  // Phase 2: fill remaining slots weighted by popularity
  while (events.length < targetEvents) {
    const igdbId = weightedPick(rng, gameIds, weights);
    const gw = IGDB_GAME_WEIGHTS.find((g) => g.igdbId === igdbId)!;
    const templates = getTemplatesForGame(igdbId);
    const tmpl = pick(rng, templates);
    const regSlug = IGDB_TO_REGISTRY_SLUG[igdbId];
    const registryGameId = regSlug
      ? (registryBySlug.get(regSlug) ?? null)
      : null;

    const daysOffset = randInt(rng, -30, 60);
    const hour = randInt(rng, 17, 22);
    const duration = randInt(rng, 1, 4);
    const start = new Date(baseTime);
    start.setDate(start.getDate() + daysOffset);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + duration * 60 * 60 * 1000);

    events.push({
      title: `${tmpl.title} — ${gw.name}`,
      description: tmpl.description,
      registryGameId,
      gameId: igdbId,
      startTime: start,
      endTime: end,
      maxPlayers: playerCounts?.get(igdbId) ?? null,
    });
  }

  return events;
}

export function generateCharacters(
  rng: Rng,
  usernames: string[],
): GeneratedCharacter[] {
  const characters: GeneratedCharacter[] = [];
  const charNamesUsed = new Set<string>();

  function uniqueCharName(base: string): string {
    let name = base;
    let counter = 1;
    while (charNamesUsed.has(name.toLowerCase())) {
      name = `${base}${counter++}`;
    }
    charNamesUsed.add(name.toLowerCase());
    return name;
  }

  for (const username of usernames) {
    const roll = rng();

    // ~55% get a WoW character
    if (roll < 0.55) {
      const classDef = pick(rng, WOW_CLASSES);
      const spec = pick(rng, classDef.specs);
      characters.push({
        username,
        registryGameSlug: 'wow',
        charName: uniqueCharName(
          username.slice(0, 8) + pick(rng, ['alt', 'wow', 'main', '']),
        ),
        class: classDef.class,
        spec: spec.name,
        role: spec.role,
        wowClass: classDef.wowClass,
        isMain: true,
      });

      // ~20% chance of an alt
      if (rng() < 0.2) {
        const altClass = pick(rng, WOW_CLASSES);
        const altSpec = pick(rng, altClass.specs);
        characters.push({
          username,
          registryGameSlug: 'wow',
          charName: uniqueCharName(username.slice(0, 6) + 'Alt'),
          class: altClass.class,
          spec: altSpec.name,
          role: altSpec.role,
          wowClass: altClass.wowClass,
          isMain: false,
        });
      }
    }
    // ~25% get an FFXIV character
    else if (roll < 0.8) {
      const job = pick(rng, FFXIV_JOBS);
      characters.push({
        username,
        registryGameSlug: 'ffxiv',
        charName: uniqueCharName(
          username.slice(0, 8) + pick(rng, ['xiv', 'ff', '', 'char']),
        ),
        class: job.class,
        spec: null,
        role: job.role,
        wowClass: null,
        isMain: true,
      });

      // ~20% chance of alt
      if (rng() < 0.2) {
        const altJob = pick(rng, FFXIV_JOBS);
        characters.push({
          username,
          registryGameSlug: 'ffxiv',
          charName: uniqueCharName(username.slice(0, 6) + 'Alt'),
          class: altJob.class,
          spec: null,
          role: altJob.role,
          wowClass: null,
          isMain: false,
        });
      }
    }
    // ~15% get a WoW Classic character
    else if (roll < 0.95) {
      const classDef = pick(rng, WOW_CLASSES.slice(0, 9)); // no DH/Evoker in classic
      const spec = pick(rng, classDef.specs);
      characters.push({
        username,
        registryGameSlug: 'wow-classic',
        charName: uniqueCharName(
          username.slice(0, 8) + pick(rng, ['classic', 'era', '', 'old']),
        ),
        class: classDef.class,
        spec: spec.name,
        role: spec.role,
        wowClass: classDef.wowClass,
        isMain: true,
      });
    }
    // ~5% get no characters (game-only users)
  }

  return characters;
}

export function generateSignups(
  rng: Rng,
  events: GeneratedEvent[],
  allUsernames: string[],
  characters: GeneratedCharacter[],
): GeneratedSignup[] {
  const signups: GeneratedSignup[] = [];

  // Build character lookup: username+registryGameSlug → exists
  const charLookup = new Set(
    characters.map((c) => `${c.username}:${c.registryGameSlug}`),
  );

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const gameWeight =
      IGDB_GAME_WEIGHTS.find((g) => g.igdbId === event.gameId)?.weight ?? 1;
    const baseSignups = randInt(rng, 5, Math.min(25, 5 + gameWeight * 2));
    const maxAllowed = event.maxPlayers ?? allUsernames.length;
    const numSignups = Math.min(baseSignups, maxAllowed, allUsernames.length);

    const selected = pickN(rng, allUsernames, numSignups);
    const regSlug = IGDB_TO_REGISTRY_SLUG[event.gameId];

    for (const username of selected) {
      const hasChar = regSlug
        ? charLookup.has(`${username}:${regSlug}`)
        : false;

      signups.push({
        eventIdx: i,
        username,
        confirmationStatus: hasChar ? 'confirmed' : 'pending',
      });
    }
  }

  return signups;
}

/** Expand a time slot into individual hour entries, handling midnight wrap */
function expandSlot(
  username: string,
  day: number,
  startHour: number,
  endHour: number,
): GeneratedGameTime[] {
  const slots: GeneratedGameTime[] = [];
  const effectiveEnd = endHour === 0 ? 24 : endHour;
  if (effectiveEnd > startHour) {
    for (let h = startHour; h < effectiveEnd; h++) {
      slots.push({ username, dayOfWeek: day, startHour: h });
    }
  } else {
    // Wraps past midnight
    for (let h = startHour; h < 24; h++) {
      slots.push({ username, dayOfWeek: day, startHour: h });
    }
    const nextDay = (day + 1) % 7;
    for (let h = 0; h < endHour; h++) {
      slots.push({ username, dayOfWeek: nextDay, startHour: h });
    }
  }
  return slots;
}

export function generateGameTime(
  rng: Rng,
  usernames: string[],
): GeneratedGameTime[] {
  const slots: GeneratedGameTime[] = [];
  const archetypeWeights = ARCHETYPES.map((a) => a.weight);

  const weekdays = [0, 1, 2, 3, 4];
  const weekends = [5, 6];

  for (const username of usernames) {
    const archetype = weightedPick(rng, ARCHETYPES, archetypeWeights);

    const activeDays = randInt(rng, 2, 5);
    const selectedWeekdays = pickN(rng, weekdays, activeDays);
    const activeWeekendDays = randInt(rng, 1, 2);
    const selectedWeekends = pickN(rng, weekends, activeWeekendDays);

    for (const day of selectedWeekdays) {
      for (const slot of archetype.weekdaySlots) {
        slots.push(...expandSlot(username, day, slot.start, slot.end));
      }
    }

    for (const day of selectedWeekends) {
      for (const slot of archetype.weekendSlots) {
        slots.push(...expandSlot(username, day, slot.start, slot.end));
      }
    }
  }

  return slots;
}

export function generateAvailability(
  rng: Rng,
  usernames: string[],
  baseTime: Date,
): GeneratedAvailability[] {
  const blocks: GeneratedAvailability[] = [];
  const baseHour = new Date(baseTime);
  baseHour.setMinutes(0, 0, 0);

  const hoursFromBase = (hours: number) =>
    new Date(baseHour.getTime() + hours * 60 * 60 * 1000);

  for (const username of usernames) {
    // Each user gets 2-4 availability blocks
    const numBlocks = randInt(rng, 2, 4);
    for (let i = 0; i < numBlocks; i++) {
      const offsetHours = randInt(rng, -48, 168); // -2 days to +7 days
      const durationHours = randInt(rng, 2, 8);
      const isAvailable = rng() < 0.7;

      blocks.push({
        username,
        start: hoursFromBase(offsetHours),
        end: hoursFromBase(offsetHours + durationHours),
        status: isAvailable ? 'available' : 'blocked',
      });
    }
  }

  return blocks;
}

const NOTIFICATION_TEMPLATES: {
  type: string;
  title: string;
  messageTemplate: string;
}[] = [
  {
    type: 'slot_vacated',
    title: 'Roster Slot Available',
    messageTemplate: 'A {role} slot opened up in "{event}" — claim it now!',
  },
  {
    type: 'event_reminder',
    title: 'Event Starting Soon',
    messageTemplate: '"{event}" starts in 24 hours. Don\'t forget to sign up!',
  },
  {
    type: 'new_event',
    title: 'New Event Created',
    messageTemplate: '{creator} created a new event: "{event}"',
  },
  {
    type: 'subscribed_game',
    title: 'New Event for Your Favorite Game',
    messageTemplate: 'A new {game} event has been scheduled: "{event}"',
  },
  {
    type: 'event_reminder',
    title: 'Event Tomorrow',
    messageTemplate: 'Don\'t forget about "{event}" tomorrow!',
  },
  {
    type: 'slot_vacated',
    title: 'Healer Needed',
    messageTemplate: 'A Healer slot is available in "{event}"',
  },
  {
    type: 'slot_vacated',
    title: 'Tank Spot Open',
    messageTemplate: 'A Tank spot just opened in "{event}" — grab it!',
  },
  {
    type: 'new_event',
    title: 'Weekly Raid Scheduled',
    messageTemplate: 'A new weekly raid has been posted: "{event}"',
  },
  {
    type: 'event_reminder',
    title: 'Reminder: Event Tonight',
    messageTemplate: '"{event}" is happening tonight. See you there!',
  },
  {
    type: 'subscribed_game',
    title: 'New Activity for a Game You Play',
    messageTemplate: 'Check out the new {game} event: "{event}"',
  },
];

export function generateNotifications(
  rng: Rng,
  usernames: string[],
  events: GeneratedEvent[],
  baseTime: Date,
): GeneratedNotification[] {
  const notifications: GeneratedNotification[] = [];
  const targetCount = 300;
  const roles = ['Tank', 'Healer', 'DPS'];

  while (notifications.length < targetCount) {
    const username = pick(rng, usernames);
    const tmpl = pick(rng, NOTIFICATION_TEMPLATES);
    const event = pick(rng, events);
    const hoursAgo = randInt(rng, 1, 168); // 1 hour to 7 days ago
    const createdAt = new Date(baseTime.getTime() - hoursAgo * 60 * 60 * 1000);
    const isRead = rng() < 0.4;
    const readAt = isRead
      ? new Date(createdAt.getTime() + randInt(rng, 1, 24) * 60 * 60 * 1000)
      : null;

    const gameName =
      IGDB_GAME_WEIGHTS.find((g) => g.igdbId === event.gameId)?.name ??
      event.gameId;
    const message = tmpl.messageTemplate
      .replace('{event}', event.title)
      .replace('{role}', pick(rng, roles))
      .replace('{creator}', pick(rng, usernames))
      .replace('{game}', gameName);

    notifications.push({
      username,
      type: tmpl.type,
      title: tmpl.title,
      message,
      payload: { eventTitle: event.title },
      createdAt,
      readAt,
    });
  }

  return notifications;
}

export function generateNotifPreferences(
  rng: Rng,
  usernames: string[],
): GeneratedNotifPreference[] {
  const types = [
    'slot_vacated',
    'event_reminder',
    'new_event',
    'subscribed_game',
    'achievement_unlocked',
    'level_up',
    'missed_event_nudge',
  ];
  const channels = ['inApp', 'push', 'discord'];

  return usernames.map((username) => {
    const channelPrefs: Record<string, Record<string, boolean>> = {};
    for (const type of types) {
      channelPrefs[type] = {};
      for (const channel of channels) {
        // inApp nearly always on, push/discord ~60% on
        channelPrefs[type][channel] =
          channel === 'inApp' ? rng() < 0.95 : rng() < 0.6;
      }
    }
    return { username, channelPrefs };
  });
}

export function generateGameInterests(
  rng: Rng,
  usernames: string[],
  allIgdbIds: number[],
): GeneratedGameInterest[] {
  const interests: GeneratedGameInterest[] = [];

  for (const username of usernames) {
    const numInterests = randInt(rng, 2, 7);
    const selected = pickN(rng, allIgdbIds, numInterests);
    for (const igdbId of selected) {
      interests.push({ username, igdbId });
    }
  }

  return interests;
}

/** Collect all unique notification titles produced by the generator */
export function getAllNotificationTitles(): string[] {
  return [...new Set(NOTIFICATION_TEMPLATES.map((t) => t.title))];
}
