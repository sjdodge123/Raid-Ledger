import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import {
  DrizzleModule,
  DrizzleAsyncProvider,
} from '../src/drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../src/drizzle/schema';
import { findGameByNormalizedName } from '../src/igdb/igdb-name-dedup.helpers';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

/**
 * Seed IGDB games from static JSON file.
 * This populates the `games` table (IGDB cache) with pre-seeded games,
 * enabling game search and discovery to work without requiring IGDB API keys.
 *
 * ROK-1283: Before inserting, each seed row is checked against existing rows
 * by normalized canonical name (the same guard that production INSERT paths
 * use in `upsertSingleGameRow`). Without this, a row with `igdb_id IS NULL`
 * but the same name would NOT trigger ON CONFLICT (igdb_id) — PG treats NULL
 * as never-equal — and the seeder would re-create the dup that migration
 * 0140 just merged. See the ROK-1283 spec for the BG3 reproduction.
 */

export interface GameSeed {
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

export function mapGameToValues(game: GameSeed) {
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

type GameValues = ReturnType<typeof mapGameToValues>;
type Db = PostgresJsDatabase<typeof schema>;

/** Column references for the excluded row in ON CONFLICT DO UPDATE. */
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

/**
 * Apply seed data onto an existing row identified by id. Mirrors
 * `applyIgdbMergeToRow` in `igdb-upsert.helpers.ts`: writes seed columns,
 * sets igdbId from the seed, marks the row enriched. Does NOT touch
 * `steamAppId` / `itadGameId` — those were set by upstream discovery and
 * the seed bundle has no values for them.
 */
async function mergeSeedIntoExistingRow(
  db: Db,
  existingId: number,
  values: GameValues,
): Promise<void> {
  await db
    .update(schema.games)
    .set({
      ...values,
      cachedAt: new Date(),
      igdbEnrichmentStatus: 'enriched',
      igdbEnrichmentRetryCount: 0,
    })
    .where(eq(schema.games.id, existingId));
}

/**
 * Upsert a batch of seed rows into `games`. For each row:
 *   1. Look up an existing row by normalized name (ROK-1113 guard).
 *      If found AND its igdbId is null OR matches the seed's igdbId → merge.
 *      Mismatched non-null igdbIds (sequels/variants) are left alone.
 *   2. Otherwise fall back to INSERT ... ON CONFLICT (igdb_id) DO UPDATE.
 * Returns the count of rows touched.
 */
export async function upsertSeedGames(
  db: Db,
  seeds: GameSeed[],
): Promise<number> {
  let touched = 0;
  for (const seed of seeds) {
    const values = mapGameToValues(seed);
    const nameMatch = await findGameByNormalizedName(db, seed.name);
    if (
      nameMatch &&
      (nameMatch.igdbId == null || nameMatch.igdbId === seed.igdbId)
    ) {
      await mergeSeedIntoExistingRow(db, nameMatch.id, values);
      touched++;
      continue;
    }
    await db
      .insert(schema.games)
      .values(values)
      .onConflictDoUpdate({
        target: schema.games.igdbId,
        set: { ...excludedCol, cachedAt: new Date() },
      });
    touched++;
  }
  return touched;
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
    const processed = await upsertSeedGames(db, seedData.games);
    console.log('📊 Seeding Summary:');
    console.log(`  ✅ Processed: ${processed} games`);
    console.log(`\n🎉 IGDB games cache seeding complete!`);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    await app.close();
    process.exit(1);
  }

  await app.close();
  process.exit(0);
}

if (require.main === module) {
  void bootstrap();
}
