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
import { seedUsers, seedCharacters } from './seed-testing-users.helpers';
import { seedThemePreferences } from './seed-testing-theme.helpers';
import {
  seedAvailability,
  seedGameTimeSlots,
} from './seed-testing-availability.helpers';

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
    await seedAvailability(db, createdUsers);

    await seedThemePreferences(db, createdUsers);

    await seedGameTimeSlots(db, createdUsers);

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
