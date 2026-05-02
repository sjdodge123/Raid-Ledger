import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../src/drizzle/schema';
import { FAKE_GAMERS } from './seed-testing-users.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type User = typeof schema.users.$inferSelect;

function roundToHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  return rounded;
}

function hoursFromNow(baseHour: Date, hours: number): Date {
  return new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
}

function daysFromNow(baseHour: Date, days: number): Date {
  return new Date(baseHour.getTime() + days * 24 * 60 * 60 * 1000);
}

type AvailabilityStatus = 'available' | 'blocked';
type AvailabilityEntry = {
  username: string;
  startOffsetHours?: number;
  endOffsetHours?: number;
  startOffsetDays?: number;
  endOffsetDays?: number;
  status: AvailabilityStatus;
};

// Availability/unavailability seed data for heatmap testing.
// Offsets are relative to the rounded current hour; entries overlap with
// seeded events so the heatmap renders something visible during dev.
const AVAILABILITY_DATA: readonly AvailabilityEntry[] = [
  // Available slots (will show green on heatmap)
  {
    username: 'ShadowMage',
    startOffsetHours: -2,
    endOffsetHours: 4,
    status: 'available',
  },
  {
    username: 'DragonSlayer99',
    startOffsetHours: -1,
    endOffsetHours: 6,
    status: 'available',
  },
  {
    username: 'HealzForDayz',
    startOffsetHours: 0,
    endOffsetHours: 3,
    status: 'available',
  },
  {
    username: 'TankMaster',
    startOffsetHours: -3,
    endOffsetHours: 5,
    status: 'available',
  },
  {
    username: 'ProRaider',
    startOffsetHours: 1,
    endOffsetHours: 8,
    status: 'available',
  },
  // Blocked slots (will show gray/locked on heatmap)
  {
    username: 'HealzForDayz',
    startOffsetHours: 3,
    endOffsetHours: 6,
    status: 'blocked',
  },
  {
    username: 'CasualCarl',
    startOffsetHours: -1,
    endOffsetHours: 2,
    status: 'blocked',
  },
  {
    username: 'NightOwlGamer',
    startOffsetHours: 0,
    endOffsetHours: 4,
    status: 'blocked',
  },
  // Future unavailability
  {
    username: 'DragonSlayer99',
    startOffsetDays: 2,
    endOffsetDays: 4,
    status: 'blocked',
  },
  {
    username: 'TankMaster',
    startOffsetDays: 5,
    endOffsetDays: 7,
    status: 'blocked',
  },
];

function buildAvailabilityRows(
  createdUsers: User[],
  baseHour: Date,
): schema.NewAvailability[] {
  return AVAILABILITY_DATA.flatMap((entry) => {
    const user = createdUsers.find((u) => u.username === entry.username);
    if (!user) return [];
    const start =
      entry.startOffsetDays !== undefined
        ? daysFromNow(baseHour, entry.startOffsetDays)
        : hoursFromNow(baseHour, entry.startOffsetHours ?? 0);
    const end =
      entry.endOffsetDays !== undefined
        ? daysFromNow(baseHour, entry.endOffsetDays)
        : hoursFromNow(baseHour, entry.endOffsetHours ?? 0);
    return [{ userId: user.id, timeRange: [start, end], status: entry.status }];
  });
}

export async function seedAvailability(
  db: Db,
  createdUsers: User[],
): Promise<void> {
  console.log('\n⏰ Creating unavailability periods...\n');
  const rows = buildAvailabilityRows(createdUsers, roundToHour(new Date()));
  if (rows.length === 0) return;
  await db.insert(schema.availability).values(rows).onConflictDoNothing();
  console.log(`  ✅ Seeded ${rows.length} availability rows`);
}

// dayOfWeek: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
function expandHours(
  username: string,
  dayOfWeek: number,
  startHour: number,
  endHour: number,
) {
  const slots: { username: string; dayOfWeek: number; startHour: number }[] =
    [];
  if (endHour > startHour) {
    for (let h = startHour; h < endHour; h++)
      slots.push({ username, dayOfWeek, startHour: h });
  } else {
    // wraps past midnight — same day gets startHour..23, next day gets 0..endHour
    for (let h = startHour; h < 24; h++)
      slots.push({ username, dayOfWeek, startHour: h });
    const nextDay = (dayOfWeek + 1) % 7;
    for (let h = 0; h < endHour; h++)
      slots.push({ username, dayOfWeek: nextDay, startHour: h });
  }
  return slots;
}

function expandDays(
  username: string,
  days: number[],
  startHour: number,
  endHour: number,
) {
  return days.flatMap((d) => expandHours(username, d, startHour, endHour));
}

const weekdays = [0, 1, 2, 3, 4]; // Mon-Fri
const weekends = [5, 6]; // Sat, Sun
const allDays = [0, 1, 2, 3, 4, 5, 6];

const gameTimeSlots = [
  // ShadowMage — Raid leader, wide availability
  ...expandDays('ShadowMage', weekdays, 18, 23),
  ...expandDays('ShadowMage', weekends, 10, 23),
  // TankMaster — Weekday evenings + full weekends
  ...expandDays('TankMaster', weekdays, 19, 22),
  ...expandDays('TankMaster', weekends, 8, 23),
  // HealzForDayz — Late nights + weekend afternoons
  ...expandDays('HealzForDayz', weekdays, 21, 1), // wraps to next day 0
  ...expandDays('HealzForDayz', weekends, 13, 20),
  // DragonSlayer99 — Early evenings weekdays, scattered weekend
  ...expandDays('DragonSlayer99', weekdays, 17, 21),
  ...expandHours('DragonSlayer99', 5, 10, 14), // Sat 10-14
  ...expandHours('DragonSlayer99', 6, 16, 20), // Sun 16-20
  // LootGoblin — Night owl, daily 22-03
  ...expandDays('LootGoblin', allDays, 22, 3),
  // NightOwlGamer — Night owl variant
  ...expandDays('NightOwlGamer', weekdays, 23, 4),
  ...expandDays('NightOwlGamer', weekends, 21, 4),
  // CasualCarl — Light schedule
  ...expandHours('CasualCarl', 2, 18, 22), // Wed 18-22
  ...expandHours('CasualCarl', 4, 19, 23), // Fri 19-23
  ...expandHours('CasualCarl', 5, 12, 18), // Sat 12-18
  // ProRaider — Hardcore, big blocks
  ...expandDays('ProRaider', [0, 1, 2, 3], 17, 23), // Mon-Thu 17-23
  ...expandDays('ProRaider', [4, 5], 15, 2), // Fri-Sat 15-02
  ...expandHours('ProRaider', 6, 12, 22), // Sun 12-22
];

export async function seedGameTimeSlots(
  db: Db,
  createdUsers: User[],
): Promise<void> {
  console.log('\n🕹️  Seeding game time templates...\n');

  const gameTimeValues = gameTimeSlots
    .map((slot) => {
      const user = createdUsers.find((u) => u.username === slot.username);
      if (!user) return null;
      return {
        userId: user.id,
        dayOfWeek: slot.dayOfWeek,
        startHour: slot.startHour,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  if (gameTimeValues.length > 0) {
    await db
      .insert(schema.gameTimeTemplates)
      .values(gameTimeValues)
      .onConflictDoNothing();
    console.log(
      `  ✅ Seeded ${gameTimeValues.length} game time slots across ${FAKE_GAMERS.length} users`,
    );
  }
}
