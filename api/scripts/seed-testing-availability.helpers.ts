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

export async function seedAvailability(
  db: Db,
  createdUsers: User[],
): Promise<void> {
  console.log('\n⏰ Creating unavailability periods...\n');

  const baseHour = roundToHour(new Date());
  const h = (hours: number) => hoursFromNow(baseHour, hours);
  const d = (days: number) => daysFromNow(baseHour, days);

  // Define availability/unavailability for heatmap testing.
  // Need to overlap with event times for visibility.
  const availabilityData = [
    // Available slots (will show green on heatmap)
    {
      username: 'ShadowMage',
      start: h(-2),
      end: h(4),
      status: 'available' as const,
    },
    {
      username: 'DragonSlayer99',
      start: h(-1),
      end: h(6),
      status: 'available' as const,
    },
    {
      username: 'HealzForDayz',
      start: h(0),
      end: h(3),
      status: 'available' as const,
    },
    {
      username: 'TankMaster',
      start: h(-3),
      end: h(5),
      status: 'available' as const,
    },
    {
      username: 'ProRaider',
      start: h(1),
      end: h(8),
      status: 'available' as const,
    },

    // Blocked slots (will show gray/locked on heatmap)
    {
      username: 'HealzForDayz',
      start: h(3),
      end: h(6),
      status: 'blocked' as const,
    },
    {
      username: 'CasualCarl',
      start: h(-1),
      end: h(2),
      status: 'blocked' as const,
    },
    {
      username: 'NightOwlGamer',
      start: h(0),
      end: h(4),
      status: 'blocked' as const,
    },

    // Future unavailability
    {
      username: 'DragonSlayer99',
      start: d(2),
      end: d(4),
      status: 'blocked' as const,
    },
    {
      username: 'TankMaster',
      start: d(5),
      end: d(7),
      status: 'blocked' as const,
    },
  ];

  for (const avail of availabilityData) {
    const user = createdUsers.find((u) => u.username === avail.username);
    if (!user) continue;

    try {
      await db.insert(schema.availability).values({
        userId: user.id,
        timeRange: [avail.start, avail.end],
        status: avail.status,
      });
      const icon = avail.status === 'available' ? '✅' : '❌';
      console.log(
        `  ${icon} ${user.username}: ${avail.status} (${avail.start.toLocaleTimeString()} - ${avail.end.toLocaleTimeString()})`,
      );
    } catch {
      console.log(
        `  ⏭️  Skipped availability for ${user.username} (may exist)`,
      );
    }
  }
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
