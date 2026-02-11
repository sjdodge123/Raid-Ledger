/**
 * Demo Data Constants (ROK-193)
 *
 * Single source of truth for all demo data definitions.
 * Both the DemoDataService (runtime install/delete) and CLI seed scripts
 * reference these constants to guarantee consistency.
 */

/** All demo usernames — used to identify and delete demo data */
export const DEMO_USERNAMES = [
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

/** Fake gamer accounts (excludes SeedAdmin which is created separately) */
export const FAKE_GAMERS = [
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

/** Character definitions per user */
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
  { username: 'CasualCarl', role: 'Player' },
] as const;

/** Notification titles used by demo data — used for deletion matching */
export const DEMO_NOTIFICATION_TITLES = [
  'Roster Slot Available',
  'Event Starting Soon',
  'New Event Created',
  'New Event for Your Favorite Game',
  'Healer Needed',
  'Event Tomorrow',
] as const;

/** Blizzard CDN URL for WoW class icons */
export function getClassIconUrl(wowClass: string): string {
  return `https://render.worldofwarcraft.com/icons/56/classicon_${wowClass.toLowerCase()}.jpg`;
}

/** Helper: round a Date to the start of its hour */
function roundToHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  return rounded;
}

/** Helper: expand a time range into individual hour slots */
function expandHours(
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
function expandDays(
  username: string,
  days: number[],
  startHour: number,
  endHour: number,
) {
  return days.flatMap((d) => expandHours(username, d, startHour, endHour));
}

/** Generate game time slot definitions */
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

/** Generate availability definitions (time-relative) */
export function getAvailabilityDefinitions(): {
  username: string;
  start: Date;
  end: Date;
  status: 'available' | 'blocked';
}[] {
  const now = new Date();
  const baseHour = roundToHour(now);

  const hoursFromNow = (hours: number) =>
    new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
  const daysFromNow = (days: number) =>
    new Date(baseHour.getTime() + days * 24 * 60 * 60 * 1000);

  return [
    {
      username: 'ShadowMage',
      start: hoursFromNow(-2),
      end: hoursFromNow(4),
      status: 'available',
    },
    {
      username: 'DragonSlayer99',
      start: hoursFromNow(-1),
      end: hoursFromNow(6),
      status: 'available',
    },
    {
      username: 'HealzForDayz',
      start: hoursFromNow(0),
      end: hoursFromNow(3),
      status: 'available',
    },
    {
      username: 'TankMaster',
      start: hoursFromNow(-3),
      end: hoursFromNow(5),
      status: 'available',
    },
    {
      username: 'ProRaider',
      start: hoursFromNow(1),
      end: hoursFromNow(8),
      status: 'available',
    },
    {
      username: 'HealzForDayz',
      start: hoursFromNow(3),
      end: hoursFromNow(6),
      status: 'blocked',
    },
    {
      username: 'CasualCarl',
      start: hoursFromNow(-1),
      end: hoursFromNow(2),
      status: 'blocked',
    },
    {
      username: 'NightOwlGamer',
      start: hoursFromNow(0),
      end: hoursFromNow(4),
      status: 'blocked',
    },
    {
      username: 'DragonSlayer99',
      start: daysFromNow(2),
      end: daysFromNow(4),
      status: 'blocked',
    },
    {
      username: 'TankMaster',
      start: daysFromNow(5),
      end: daysFromNow(7),
      status: 'blocked',
    },
  ];
}

interface GameRegistryEntry {
  id: string;
  slug: string;
}

/** Generate event definitions (time-relative, needs game registry IDs) */
export function getEventsDefinitions(games: GameRegistryEntry[]) {
  const wowGame = games.find((g) => g.slug === 'wow');
  const valheimGame = games.find((g) => g.slug === 'valheim');
  const ffxivGame = games.find((g) => g.slug === 'ffxiv');

  const now = new Date();
  const baseHour = roundToHour(now);
  const hoursFromNow = (hours: number) =>
    new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
  const daysFromNow = (days: number) =>
    new Date(baseHour.getTime() + days * 24 * 60 * 60 * 1000);

  return [
    {
      title: 'Heroic Amirdrassil Clear',
      description: 'Weekly heroic raid run. All welcome! BE-only pulls.',
      registryGameId: wowGame?.id ?? null,
      gameId: '123',
      startTime: hoursFromNow(-1),
      endTime: hoursFromNow(2),
    },
    {
      title: 'Mythic+ Push Night',
      description: 'High key pushing session. Need 2 DPS, 1 tank.',
      registryGameId: wowGame?.id ?? null,
      gameId: '123',
      startTime: hoursFromNow(2),
      endTime: hoursFromNow(5),
    },
    {
      title: 'Valheim Boss Rush',
      description: 'Taking down all bosses in one session!',
      registryGameId: valheimGame?.id ?? null,
      gameId: '104967',
      startTime: daysFromNow(1),
      endTime: new Date(daysFromNow(1).getTime() + 3 * 60 * 60 * 1000),
    },
    {
      title: 'FFXIV Savage Prog',
      description: 'M4S progression - Phase 2 onwards. Know the fight!',
      registryGameId: ffxivGame?.id ?? null,
      gameId: '14729',
      startTime: daysFromNow(3),
      endTime: new Date(daysFromNow(3).getTime() + 3 * 60 * 60 * 1000),
    },
    {
      title: 'Morning Dungeon Runs',
      description: 'Casual dungeon runs for alts.',
      registryGameId: wowGame?.id ?? null,
      gameId: '123',
      startTime: hoursFromNow(-4),
      endTime: hoursFromNow(-2),
    },
    {
      title: 'Late Night Raids',
      description: 'For the night owls. Normal mode farm.',
      registryGameId: wowGame?.id ?? null,
      gameId: '123',
      startTime: hoursFromNow(6),
      endTime: hoursFromNow(9),
    },
  ];
}

/** Generate notification definitions (needs user/event IDs) */
export function getNotificationTemplates(
  adminUserId: number,
  events: { id: number; title: string }[],
  fakeUsers: { username: string }[],
) {
  const now = new Date();
  const hoursAgo = (hours: number) =>
    new Date(now.getTime() - hours * 60 * 60 * 1000);
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return [
    {
      userId: adminUserId,
      type: 'slot_vacated' as const,
      title: 'Roster Slot Available',
      message: `A Tank slot opened up in "${events[0]?.title || 'Raid Night'}" - claim it now!`,
      payload: { eventId: events[0]?.id, role: 'Tank', position: 1 },
      createdAt: hoursAgo(2),
      readAt: null,
    },
    {
      userId: adminUserId,
      type: 'event_reminder' as const,
      title: 'Event Starting Soon',
      message: `"${events[1]?.title || 'Weekly Dungeon Run'}" starts in 24 hours. Don't forget to sign up!`,
      payload: { eventId: events[1]?.id },
      createdAt: hoursAgo(5),
      readAt: null,
    },
    {
      userId: adminUserId,
      type: 'new_event' as const,
      title: 'New Event Created',
      message: `${fakeUsers[0]?.username || 'A player'} created a new event: "${events[2]?.title || 'PvP Tournament'}"`,
      payload: { eventId: events[2]?.id },
      createdAt: hoursAgo(12),
      readAt: null,
    },
    {
      userId: adminUserId,
      type: 'subscribed_game' as const,
      title: 'New Event for Your Favorite Game',
      message: `A new Valheim event has been scheduled: "${events[3]?.title || 'Boss Rush'}"`,
      payload: { eventId: events[3]?.id, gameId: 'valheim' },
      createdAt: daysAgo(1),
      readAt: hoursAgo(20),
    },
    {
      userId: adminUserId,
      type: 'slot_vacated' as const,
      title: 'Healer Needed',
      message: `A Healer slot is available in "${events[4]?.title || 'Mythic Raid'}"`,
      payload: { eventId: events[4]?.id, role: 'Healer', position: 2 },
      createdAt: daysAgo(2),
      readAt: daysAgo(1),
    },
    {
      userId: adminUserId,
      type: 'event_reminder' as const,
      title: 'Event Tomorrow',
      message: `Don't forget about "${events[0]?.title || 'Raid Night'}" tomorrow at 8 PM`,
      payload: { eventId: events[0]?.id },
      createdAt: daysAgo(3),
      readAt: daysAgo(2),
    },
  ];
}
