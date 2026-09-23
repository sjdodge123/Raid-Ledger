import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  DrizzleModule,
  DrizzleAsyncProvider,
} from '../src/drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../src/drizzle/schema';
import { upsertSeedGame } from '../src/games-lookup/seed-games.helpers';
import { GAMES_SEED } from '../src/games-lookup/seed-games.data';
import * as dotenv from 'dotenv';

dotenv.config();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DrizzleModule,
  ],
})
class SeedModule {}

async function bootstrap() {
  console.log('🌱 Seeding game registry...\n');

  const app = await NestFactory.createApplicationContext(SeedModule);
  const db = app.get<PostgresJsDatabase<typeof schema>>(DrizzleAsyncProvider);

  try {
    for (const gameData of GAMES_SEED) {
      // iconUrl is seed-only metadata with no games column; drop it here.
      const { eventTypes, iconUrl, ...game } = gameData;
      void iconUrl;

      // ROK-400 upsert, routed through the games name-dedup guard (ROK-1563).
      const { id: gameId, action } = await upsertSeedGame(db, game);
      const verb = {
        created: '✅ Created',
        updated: '🔄 Updated',
        merged: '🔗 Merged',
      }[action];
      console.log(`  ${verb} game: ${game.name} (${game.slug})`);

      // Insert event types
      for (const eventType of eventTypes) {
        const [insertedType] = await db
          .insert(schema.eventTypes)
          .values({
            gameId,
            ...eventType,
          })
          .onConflictDoNothing()
          .returning();

        if (insertedType) {
          console.log(`      ✅ Created event type: ${eventType.name}`);
        } else {
          console.log(
            `      ⏭️  Skipped event type: ${eventType.name} (already exists)`,
          );
        }
      }
      console.log('');
    }

    console.log('🎉 Game seeding complete!');
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    await app.close();
    process.exit(1);
  }

  await app.close();
  process.exit(0);
}

bootstrap();
