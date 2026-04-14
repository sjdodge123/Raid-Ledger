/**
 * Demo Data Constants (ROK-193, expanded ROK-233)
 *
 * Single source of truth for all demo data definitions.
 * Both the DemoDataService (runtime install/delete) and CLI seed scripts
 * reference these constants to guarantee consistency.
 *
 * The original 9 hand-crafted users are preserved at the front.
 * 92 generated users are appended at module load via the deterministic generator.
 */

import {
  createRng,
  generateUsernames,
  getAllNotificationTitles,
} from './demo-data-generator';

// ─── Original hand-crafted users ─────────────────────────────────────────────

const ORIGINAL_USERNAMES = [
  'SeedAdmin',
  'ShadowMage',
  'DragonSlayer99',
  'HealzForDayz',
  'TankMaster',
  'NightOwlGamer',
  'CasualCarl',
  'ProRaider',
  'LootGoblin',
] as const;

const ORIGINAL_GAMERS = [
  {
    username: 'ShadowMage',
    avatar: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
  },
  {
    username: 'DragonSlayer99',
    avatar: 'b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7',
  },
  {
    username: 'HealzForDayz',
    avatar: 'c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8',
  },
  {
    username: 'TankMaster',
    avatar: 'd4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9',
  },
  {
    username: 'NightOwlGamer',
    avatar: 'e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
  },
  {
    username: 'CasualCarl',
    avatar: 'f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1',
  },
  {
    username: 'ProRaider',
    avatar: 'g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2',
  },
  {
    username: 'LootGoblin',
    avatar: 'h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3',
  },
] as const;

// ─── Generate 92 additional users (deterministic) ────────────────────────────
// NOTE: These run at module load time. This is intentional — the constants file
// is only imported by demo-data.service.ts and the delete path, both of which
// need the full user list. If this module is ever imported more broadly,
// consider switching to lazy initialization via getter functions.

/** Number of original hand-crafted gamers (used to slice generated-only users) */
export const ORIGINAL_GAMER_COUNT = ORIGINAL_GAMERS.length;

const rng = createRng();
const generatedUsers = generateUsernames(rng, 92, [...ORIGINAL_USERNAMES]);

/** All demo usernames — used to identify and delete demo data */
export const DEMO_USERNAMES: string[] = [
  ...ORIGINAL_USERNAMES,
  ...generatedUsers.map((u) => u.username),
];

/** Fake gamer accounts (excludes SeedAdmin which is created separately) */
export const FAKE_GAMERS: { username: string; avatar: string }[] = [
  ...ORIGINAL_GAMERS.map((g) => ({ username: g.username, avatar: g.avatar })),
  ...generatedUsers,
];

/** Character definitions per user (original hand-crafted characters) */
export const CHARACTERS_CONFIG = [
  {
    username: 'ShadowMage',
    gameIdx: 0,
    charName: 'Shadowmage',
    class: 'Mage',
    spec: 'Arcane',
    role: 'dps' as const,
    wowClass: 'mage',
  },
  {
    username: 'DragonSlayer99',
    gameIdx: 0,
    charName: 'Dragonslayer',
    class: 'Rogue',
    spec: 'Assassination',
    role: 'dps' as const,
    wowClass: 'rogue',
  },
  {
    username: 'HealzForDayz',
    gameIdx: 0,
    charName: 'Healzfordays',
    class: 'Priest',
    spec: 'Holy',
    role: 'healer' as const,
    wowClass: 'priest',
  },
  {
    username: 'TankMaster',
    gameIdx: 0,
    charName: 'Tankmaster',
    class: 'Warrior',
    spec: 'Protection',
    role: 'tank' as const,
    wowClass: 'warrior',
  },
  {
    username: 'ProRaider',
    gameIdx: 0,
    charName: 'Deathbringer',
    class: 'Death Knight',
    spec: 'Unholy',
    role: 'dps' as const,
    wowClass: 'deathknight',
  },
  {
    username: 'NightOwlGamer',
    gameIdx: 0,
    charName: 'Moonweaver',
    class: 'Druid',
    spec: 'Restoration',
    role: 'healer' as const,
    wowClass: 'druid',
  },
  {
    username: 'LootGoblin',
    gameIdx: 0,
    charName: 'Felstrike',
    class: 'Warlock',
    spec: 'Destruction',
    role: 'dps' as const,
    wowClass: 'warlock',
  },
  {
    username: 'CasualCarl',
    gameIdx: 0,
    charName: 'Shieldwall',
    class: 'Paladin',
    spec: 'Protection',
    role: 'tank' as const,
    wowClass: 'paladin',
  },
  // Second game characters (alts)
  {
    username: 'ShadowMage',
    gameIdx: 1,
    charName: 'Windwalker',
    class: 'Monk',
    spec: 'Windwalker',
    role: 'dps' as const,
    wowClass: 'monk',
  },
  {
    username: 'TankMaster',
    gameIdx: 1,
    charName: 'Earthguard',
    class: 'Shaman',
    spec: 'Restoration',
    role: 'healer' as const,
    wowClass: 'shaman',
  },
  {
    username: 'ProRaider',
    gameIdx: 1,
    charName: 'Hawkeye',
    class: 'Hunter',
    spec: 'Marksmanship',
    role: 'dps' as const,
    wowClass: 'hunter',
  },
  // Third game characters (alts)
  {
    username: 'NightOwlGamer',
    gameIdx: 2,
    charName: 'Voidcaller',
    class: 'Evoker',
    spec: 'Preservation',
    role: 'healer' as const,
    wowClass: 'evoker',
  },
  {
    username: 'LootGoblin',
    gameIdx: 2,
    charName: 'Demonbane',
    class: 'Demon Hunter',
    spec: 'Havoc',
    role: 'dps' as const,
    wowClass: 'demonhunter',
  },
] as const;

/** Theme assignments per user */
export const THEME_ASSIGNMENTS: Record<string, string> = {
  ShadowMage: 'default-dark',
  TankMaster: 'default-light',
  HealzForDayz: 'auto',
  DragonSlayer99: 'default-light',
  CasualCarl: 'default-dark',
  NightOwlGamer: 'auto',
  ProRaider: 'auto',
  LootGoblin: 'auto',
};

/** Role accounts for impersonation testing */
export const ROLE_ACCOUNTS = [
  { username: 'ShadowMage', role: 'Raid Leader' },
  { username: 'ProRaider', role: 'Raid Leader' },
  { username: 'TankMaster', role: 'Raid Leader' },
  { username: 'CasualCarl', role: 'Player' },
] as const;

/** Notification titles used by demo data — used for deletion matching */
export const DEMO_NOTIFICATION_TITLES: string[] = [
  'Roster Slot Available',
  'Event Starting Soon',
  'New Event Created',
  'New Event for Your Favorite Game',
  'Healer Needed',
  'Event Tomorrow',
  ...getAllNotificationTitles(),
].filter((v, i, arr) => arr.indexOf(v) === i); // dedupe

/** Blizzard CDN URL for WoW class icons */
export function getClassIconUrl(wowClass: string): string {
  return `https://render.worldofwarcraft.com/icons/56/classicon_${wowClass.toLowerCase()}.jpg`;
}

/** Helper: expand a time range into individual hour slots */
export function expandHours(
  username: string,
  dayOfWeek: number,
  startHour: number,
  endHour: number,
): { username: string; dayOfWeek: number; startHour: number }[] {
  const slots: { username: string; dayOfWeek: number; startHour: number }[] =
    [];
  if (endHour > startHour) {
    for (let h = startHour; h < endHour; h++)
      slots.push({ username, dayOfWeek, startHour: h });
  } else {
    for (let h = startHour; h < 24; h++)
      slots.push({ username, dayOfWeek, startHour: h });
    const nextDay = (dayOfWeek + 1) % 7;
    for (let h = 0; h < endHour; h++)
      slots.push({ username, dayOfWeek: nextDay, startHour: h });
  }
  return slots;
}

/** Helper: expand across multiple days */
export function expandDays(
  username: string,
  days: number[],
  startHour: number,
  endHour: number,
) {
  return days.flatMap((d) => expandHours(username, d, startHour, endHour));
}

/** Generate game time slot definitions (original 8 users) */
export function getGameTimeDefinitions(): {
  username: string;
  dayOfWeek: number;
  startHour: number;
}[] {
  const weekdays = [0, 1, 2, 3, 4];
  const weekends = [5, 6];
  const allDays = [0, 1, 2, 3, 4, 5, 6];

  return [
    ...expandDays('ShadowMage', weekdays, 18, 23),
    ...expandDays('ShadowMage', weekends, 10, 23),
    ...expandDays('TankMaster', weekdays, 19, 22),
    ...expandDays('TankMaster', weekends, 8, 23),
    ...expandDays('HealzForDayz', weekdays, 21, 1),
    ...expandDays('HealzForDayz', weekends, 13, 20),
    ...expandDays('DragonSlayer99', weekdays, 17, 21),
    ...expandHours('DragonSlayer99', 5, 10, 14),
    ...expandHours('DragonSlayer99', 6, 16, 20),
    ...expandDays('LootGoblin', allDays, 22, 3),
    ...expandDays('NightOwlGamer', weekdays, 23, 4),
    ...expandDays('NightOwlGamer', weekends, 21, 4),
    ...expandHours('CasualCarl', 2, 18, 22),
    ...expandHours('CasualCarl', 4, 19, 23),
    ...expandHours('CasualCarl', 5, 12, 18),
    ...expandDays('ProRaider', [0, 1, 2, 3], 17, 23),
    ...expandDays('ProRaider', [4, 5], 15, 2),
    ...expandHours('ProRaider', 6, 12, 22),
  ];
}

// Re-export from extracted modules for backward compatibility
export { getAvailabilityDefinitions } from './demo-data-availability';
export {
  getEventsDefinitions,
  getEdgeCaseDefinitions,
} from './demo-data-events';
export type { EdgeCaseEvent } from './demo-data-events';
export { getNotificationTemplates } from './demo-data-notifications';
