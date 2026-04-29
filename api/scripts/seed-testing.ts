import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  DrizzleModule,
  DrizzleAsyncProvider,
} from '../src/drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/drizzle/schema';
import * as dotenv from 'dotenv';
import {
  FAKE_GAMERS,
  seedUsers,
  seedCharacters,
} from './seed-testing-users.helpers';

dotenv.config();

/**
 * Seed data for testing users, signups, and availability.
 * Creates fake gamers with event signups and some unavailable periods.
 */

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DrizzleModule,
  ],
})
class SeedTestingModule {}

async function bootstrap() {
  console.log('🌱 Seeding test users, signups, and availability...\n');

  const app = await NestFactory.createApplicationContext(SeedTestingModule);
  const db = app.get<PostgresJsDatabase<typeof schema>>(DrizzleAsyncProvider);

  try {
    const createdUsers = await seedUsers(db);
    await seedCharacters(db, createdUsers);

    // =====================
    // Create Event Signups (linked to characters)
    // =====================
    console.log('\n📝 Creating event signups with character links...\n');

    const allEvents = await db.select().from(schema.events);

    // Pre-fetch all characters for our seed users
    const allCharacters = await db.select().from(schema.characters);

    for (const event of allEvents) {
      // Sign up 3-5 random users for each event
      const numSignups = Math.floor(Math.random() * 3) + 3;
      const shuffledUsers = [...createdUsers].sort(() => Math.random() - 0.5);
      const selectedUsers = shuffledUsers.slice(0, numSignups);

      for (const user of selectedUsers) {
        // Check if signup exists
        const existingSignup = await db
          .select()
          .from(schema.eventSignups)
          .where(eq(schema.eventSignups.eventId, event.id))
          .then((rows) => rows.find((r) => r.userId === user.id));

        if (!existingSignup) {
          // Find user's character for this event's game
          const userChar = event.gameId
            ? allCharacters.find(
                (c) => c.userId === user.id && c.gameId === event.gameId,
              )
            : undefined;

          await db.insert(schema.eventSignups).values({
            eventId: event.id,
            userId: user.id,
            characterId: userChar?.id ?? null,
            confirmationStatus: userChar ? 'confirmed' : 'pending',
          });
          const charInfo = userChar ? ` [${userChar.name}]` : '';
          console.log(`  ✅ ${user.username}${charInfo} → ${event.title}`);
        }
      }
    }

    // =====================
    // Create Unavailability
    // =====================
    console.log('\n⏰ Creating unavailability periods...\n');

    const now = new Date();
    const roundToHour = (date: Date): Date => {
      const rounded = new Date(date);
      rounded.setMinutes(0, 0, 0);
      return rounded;
    };
    const baseHour = roundToHour(now);

    // Helper functions
    const hoursFromNow = (hours: number) =>
      new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
    const daysFromNow = (days: number) =>
      new Date(baseHour.getTime() + days * 24 * 60 * 60 * 1000);

    // Define availability/unavailability for heatmap testing
    // Need to overlap with event times for visibility
    const availabilityData = [
      // Available slots (will show green on heatmap)
      {
        username: 'ShadowMage',
        start: hoursFromNow(-2),
        end: hoursFromNow(4),
        status: 'available' as const,
      },
      {
        username: 'DragonSlayer99',
        start: hoursFromNow(-1),
        end: hoursFromNow(6),
        status: 'available' as const,
      },
      {
        username: 'HealzForDayz',
        start: hoursFromNow(0),
        end: hoursFromNow(3),
        status: 'available' as const,
      },
      {
        username: 'TankMaster',
        start: hoursFromNow(-3),
        end: hoursFromNow(5),
        status: 'available' as const,
      },
      {
        username: 'ProRaider',
        start: hoursFromNow(1),
        end: hoursFromNow(8),
        status: 'available' as const,
      },

      // Blocked slots (will show gray/locked on heatmap)
      {
        username: 'HealzForDayz',
        start: hoursFromNow(3),
        end: hoursFromNow(6),
        status: 'blocked' as const,
      },
      {
        username: 'CasualCarl',
        start: hoursFromNow(-1),
        end: hoursFromNow(2),
        status: 'blocked' as const,
      },
      {
        username: 'NightOwlGamer',
        start: hoursFromNow(0),
        end: hoursFromNow(4),
        status: 'blocked' as const,
      },

      // Future unavailability
      {
        username: 'DragonSlayer99',
        start: daysFromNow(2),
        end: daysFromNow(4),
        status: 'blocked' as const,
      },
      {
        username: 'TankMaster',
        start: daysFromNow(5),
        end: daysFromNow(7),
        status: 'blocked' as const,
      },
    ];

    for (const avail of availabilityData) {
      const user = createdUsers.find((u) => u.username === avail.username);
      if (!user) continue;

      // Create availability record
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

    // =====================
    // Seed Theme Preferences (ROK-124)
    // =====================
    console.log('\n🎨 Setting theme preferences...\n');

    const themeAssignments: Record<string, string> = {
      ShadowMage: 'default-dark',
      TankMaster: 'default-light',
      HealzForDayz: 'auto',
      DragonSlayer99: 'default-light',
      CasualCarl: 'default-dark',
      NightOwlGamer: 'auto',
      ProRaider: 'auto',
      LootGoblin: 'auto',
    };

    for (const [username, theme] of Object.entries(themeAssignments)) {
      const user = createdUsers.find((u) => u.username === username);
      if (!user) continue;

      try {
        await db
          .insert(schema.userPreferences)
          .values({
            userId: user.id,
            key: 'theme',
            value: theme,
          })
          .onConflictDoNothing();
        console.log(`  🎨 ${username} → ${theme}`);
      } catch {
        console.log(`  ⏭️  Skipped theme for ${username} (may exist)`);
      }
    }

    // Also set admin theme preference
    const adminUser = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.role, 'admin'))
      .limit(1)
      .then((rows) => rows[0]);

    if (adminUser) {
      try {
        await db
          .insert(schema.userPreferences)
          .values({
            userId: adminUser.id,
            key: 'theme',
            value: 'auto',
          })
          .onConflictDoNothing();
        console.log(`  🎨 ${adminUser.username} (admin) → auto`);
      } catch {
        console.log(`  ⏭️  Skipped theme for admin (may exist)`);
      }
    }

    // =====================
    // Seed Game Time Templates (ROK-227)
    // =====================
    console.log('\n🕹️  Seeding game time templates...\n');

    // dayOfWeek: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
    function expandHours(
      username: string,
      dayOfWeek: number,
      startHour: number,
      endHour: number,
    ) {
      const slots: {
        username: string;
        dayOfWeek: number;
        startHour: number;
      }[] = [];
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

    // Map usernames to user IDs
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

    console.log('\n🎉 Testing data seed complete!');
    console.log('\n📍 View events at: http://localhost:80/events');
    console.log('📍 View calendar at: http://localhost:80/calendar');
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    await app.close();
    process.exit(1);
  }

  await app.close();
  process.exit(0);
}

bootstrap();
