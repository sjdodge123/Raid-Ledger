import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  DrizzleModule,
  DrizzleAsyncProvider,
} from '../src/drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../src/drizzle/schema';
import {
  findGameIdsByNormalizedName,
  type NameMatch,
} from '../src/igdb/igdb-name-dedup.helpers';
import { normalizeForDedup } from '../src/igdb/igdb-search-dedup.helpers';
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

/** Chunk size for the batched multi-row INSERT (49 seeds fit one statement; guard for growth). */
const INSERT_CHUNK_SIZE = 200;

/**
 * ROK-1334: the set of seed igdb_ids that already own a row. Used for the
 * Codex-P1 orphan-safety check (don't UPDATE a null-igdb_id orphan to an
 * igdb_id another row already holds — that would hit the UNIQUE index and abort
 * boot). ONE `IN (...)` query replaces the old per-row `rowExistsWithIgdbId`
 * SELECT.
 *
 * NOTE: a `cachedAt`-based freshness short-circuit was considered (skip seeds
 * whose row was cached < 7 days ago) but REJECTED — it conflicts with the
 * load-bearing Case 4 spec (`touched === 1` while a fresh canonical row is
 * present). The batching below already removes the ~147 serial roundtrips, so
 * the freshness skip is an unnecessary secondary win. See ROK-1334 notes.
 */
async function selectPresentIgdbIds(
  db: Db,
  igdbIds: number[],
): Promise<Set<number>> {
  const present = new Set<number>();
  if (igdbIds.length === 0) return present;
  const rows = await db
    .select({ igdbId: schema.games.igdbId })
    .from(schema.games)
    .where(inArray(schema.games.igdbId, igdbIds));
  for (const row of rows) {
    if (row.igdbId != null) present.add(row.igdbId);
  }
  return present;
}

/**
 * Decide how each seed should be applied, using the batched name-match map and
 * the present-igdb_id set. Mirrors the per-row decision the old loop made:
 *   - sameIgdbId match → merge into that row (idempotent).
 *   - null-igdb_id orphan AND no row already owns the seed's igdb_id → merge.
 *   - everything else (no match, sequel collision, or orphan whose igdb_id is
 *     already owned by a canonical row — Codex P1 2026-05-14) → batch INSERT
 *     ... ON CONFLICT (igdb_id), which updates the canonical row and leaves the
 *     orphan for the dedup audit (ROK-1277/1278).
 */
function partitionSeeds(
  seeds: GameSeed[],
  nameMap: Map<string, NameMatch>,
  present: Set<number>,
): {
  merges: Array<{ id: number; values: GameValues }>;
  inserts: GameValues[];
} {
  const merges: Array<{ id: number; values: GameValues }> = [];
  const inserts: GameValues[] = [];
  for (const seed of seeds) {
    const values = mapGameToValues(seed);
    const match = nameMap.get(normalizeForDedup(seed.name));
    const sameIgdbId = match?.igdbId === seed.igdbId;
    const orphanSafe = match?.igdbId == null && !present.has(seed.igdbId);
    if (match && (sameIgdbId || orphanSafe)) {
      merges.push({ id: match.id, values });
    } else {
      inserts.push(values);
    }
  }
  return { merges, inserts };
}

/** Batched multi-row INSERT ... ON CONFLICT (igdb_id) DO UPDATE, chunked for growth. */
async function insertSeedBatch(db: Db, inserts: GameValues[]): Promise<void> {
  for (let i = 0; i < inserts.length; i += INSERT_CHUNK_SIZE) {
    const chunk = inserts.slice(i, i + INSERT_CHUNK_SIZE);
    await db
      .insert(schema.games)
      .values(chunk)
      .onConflictDoUpdate({
        target: schema.games.igdbId,
        set: { ...excludedCol, cachedAt: sql`now()` },
      });
  }
}

/**
 * Upsert a batch of seed rows into `games` (ROK-1334 — batched).
 *
 * Replaces the old per-row loop (up to 3 SERIAL roundtrips/row: a leading-
 * wildcard `findGameByNormalizedName` SELECT, a `rowExistsWithIgdbId` SELECT,
 * then the write) with a handful of batched statements:
 *   1. ONE `IN (...)` SELECT for which seed igdb_ids already own a row
 *      (orphan-safety, Codex P1 2026-05-14).
 *   2. ONE `findGameIdsByNormalizedName` SELECT (ROK-1113 name-dedup guard,
 *      reused from the live-sync path) to find existing rows by canonical name.
 *   3. Partition into merges (existing row to UPDATE) vs inserts, then a
 *      chunked multi-row INSERT ... ON CONFLICT (igdb_id) DO UPDATE for the
 *      inserts plus per-id UPDATEs for the (rare) merges.
 *
 * Keeps the original signature and returns the count of rows touched.
 */
export async function upsertSeedGames(
  db: Db,
  seeds: GameSeed[],
): Promise<number> {
  if (seeds.length === 0) return 0;
  const present = await selectPresentIgdbIds(
    db,
    seeds.map((s) => s.igdbId),
  );
  const nameMap = await findGameIdsByNormalizedName(
    db,
    seeds.map((s) => s.name),
  );
  const { merges, inserts } = partitionSeeds(seeds, nameMap, present);

  for (const { id, values } of merges) {
    await mergeSeedIntoExistingRow(db, id, values);
  }
  await insertSeedBatch(db, inserts);

  return merges.length + inserts.length;
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
