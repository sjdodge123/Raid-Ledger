import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  DrizzleModule,
  DrizzleAsyncProvider,
} from '../src/drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../src/drizzle/schema';
import * as dotenv from 'dotenv';
import { seedUsers, seedCharacters } from './seed-testing-users.helpers';
import { seedEventSignups } from './seed-testing-events.helpers';
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
    await seedEventSignups(db, createdUsers);
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

void bootstrap();
