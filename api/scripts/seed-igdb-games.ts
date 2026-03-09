import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  DrizzleModule,
  DrizzleAsyncProvider,
} from '../src/drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../src/drizzle/schema';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

/**
 * Seed IGDB games from static JSON file.
 * This populates the `games` table (IGDB cache) with pre-seeded games,
 * enabling game search and discovery to work without requiring IGDB API keys.
 *
 * Uses upsert (ON CONFLICT DO UPDATE) to safely re-run without duplicates.
 * Writes all expanded fields (summary, rating, gameModes, screenshots, etc.)
 */

interface GameSeed {
  igdbId: number;
  name: string;
  slug: string;
  coverUrl: string | null;
  genres?: number[];
  summary?: string | null;
  rating?: number | null;
  aggregatedRating?: number | null;
  popularity?: number | null;
  gameModes?: number[];
  themes?: number[];
  platforms?: number[];
  screenshots?: string[];
  videos?: { name: string; videoId: string }[];
  firstReleaseDate?: string | null;
  playerCount?: { min: number; max: number } | null;
  twitchGameId?: string | null;
  crossplay?: boolean | null;
}

interface GamesSeedFile {
  version: string;
  generatedAt: string;
  source: string;
  games: GameSeed[];
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DrizzleModule,
  ],
})
class SeedModule {}

function mapGameToValues(game: GameSeed) {
  return {
    igdbId: game.igdbId,
    name: game.name,
    slug: game.slug,
    coverUrl: game.coverUrl,
    genres: game.genres ?? [],
    summary: game.summary ?? null,
    rating: game.rating ?? null,
    aggregatedRating: game.aggregatedRating ?? null,
    popularity: game.popularity ?? null,
    gameModes: game.gameModes ?? [],
    themes: game.themes ?? [],
    platforms: game.platforms ?? [],
    screenshots: game.screenshots ?? [],
    videos: game.videos ?? [],
    firstReleaseDate: game.firstReleaseDate
      ? new Date(game.firstReleaseDate)
      : null,
    playerCount: game.playerCount ?? null,
    twitchGameId: game.twitchGameId ?? null,
    crossplay: game.crossplay ?? null,
  };
}

/** Column references for the excluded row in ON CONFLICT DO UPDATE */
const excludedCol = {
  name: sql`excluded.name`,
  slug: sql`excluded.slug`,
  coverUrl: sql`excluded.cover_url`,
  genres: sql`excluded.genres`,
  summary: sql`excluded.summary`,
  rating: sql`excluded.rating`,
  aggregatedRating: sql`excluded.aggregated_rating`,
  popularity: sql`excluded.popularity`,
  gameModes: sql`excluded.game_modes`,
  themes: sql`excluded.themes`,
  platforms: sql`excluded.platforms`,
  screenshots: sql`excluded.screenshots`,
  videos: sql`excluded.videos`,
  firstReleaseDate: sql`excluded.first_release_date`,
  playerCount: sql`excluded.player_count`,
  twitchGameId: sql`excluded.twitch_game_id`,
  crossplay: sql`excluded.crossplay`,
};

function loadSeedData(): GamesSeedFile {
  const seedPath = path.join(__dirname, '../seeds/games-seed.json');
  if (!fs.existsSync(seedPath)) {
    console.error(`❌ Seed file not found: ${seedPath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as GamesSeedFile;
}

async function bootstrap() {
  console.log('🎮 Seeding IGDB games cache...\n');

  const seedData = loadSeedData();
  console.log(
    `📦 Loaded ${seedData.games.length} games from ${seedData.source} (v${seedData.version})\n`,
  );

  const app = await NestFactory.createApplicationContext(SeedModule);
  const db = app.get<PostgresJsDatabase<typeof schema>>(DrizzleAsyncProvider);

  try {
    const rows = seedData.games.map(mapGameToValues);

    // Batch upsert: insert all games in a single query
    const result = await db
      .insert(schema.games)
      .values(rows)
      .onConflictDoUpdate({
        target: schema.games.igdbId,
        set: { ...excludedCol, cachedAt: new Date() },
      })
      .returning();

    console.log('📊 Seeding Summary:');
    console.log(`  ✅ Processed: ${result.length} games`);
    console.log(`\n🎉 IGDB games cache seeding complete!`);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    await app.close();
    process.exit(1);
  }

  await app.close();
  process.exit(0);
}

void bootstrap();
