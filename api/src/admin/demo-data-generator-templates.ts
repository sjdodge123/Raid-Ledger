/**
 * Event templates, IGDB game weights, archetypes, and notification templates
 * for demo data generation.
 */

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
  { igdbId: '75379', name: 'World of Warcraft Classic', weight: 4 },
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

// ─── Event Title Templates ───────────────────────────────────────────────────

export interface EventTemplate {
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

const MMO_IGDB_IDS = new Set([
  '123',
  '75379',
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

/** Get appropriate event templates for a game by IGDB ID. */
export function getTemplatesForGame(igdbId: string): EventTemplate[] {
  if (FFXIV_IGDB_IDS.has(igdbId)) return FFXIV_TEMPLATES;
  if (MMO_IGDB_IDS.has(igdbId))
    return [...MMO_RAID_TEMPLATES, ...MMO_DUNGEON_TEMPLATES];
  if (SURVIVAL_IGDB_IDS.has(igdbId)) return SURVIVAL_TEMPLATES;
  if (SHOOTER_IGDB_IDS.has(igdbId)) return SHOOTER_TEMPLATES;
  return COOP_TEMPLATES;
}

// ─── Game Time Archetypes ────────────────────────────────────────────────────

export interface GameTimeArchetype {
  name: string;
  weight: number;
  weekdaySlots: { start: number; end: number }[];
  weekendSlots: { start: number; end: number }[];
}

export const ARCHETYPES: GameTimeArchetype[] = [
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

// ─── Notification Templates ─────────────────────────────────────────────────

export const NOTIFICATION_TEMPLATES = [
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
] as const;
