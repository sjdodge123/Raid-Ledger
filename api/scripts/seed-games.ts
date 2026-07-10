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
import { findGameByNormalizedName } from '../src/igdb/igdb-name-dedup.helpers';
import { GAMES_SEED } from './seed-games.data';
import * as dotenv from 'dotenv';

dotenv.config();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DrizzleModule,
  ],
})
class SeedModule {}

type Db = PostgresJsDatabase<typeof schema>;
type RegistryGameSeed = (typeof GAMES_SEED)[number];
/** `Omit` that distributes over unions so per-variant keys (igdbId, …) survive. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type RegistryGame = DistributiveOmit<
  RegistryGameSeed,
  'eventTypes' | 'iconUrl'
>;
type RegistryEventType = RegistryGameSeed['eventTypes'][number];

/**
 * Upsert one registry seed entry into `games` + its event types.
 *
 * Games-table INSERT guard (STRICT, CLAUDE.md): Postgres UNIQUE treats NULL as
 * never-equal, so `ON CONFLICT` cannot see an existing same-name row that
 * carries a different slug (or a NULL igdb_id). An existing row MUST be matched
 * by normalized name FIRST and merged into — never re-inserted — or the next
 * dedup migration gets silently undone on the next boot-time seed run.
 */
export async function upsertRegistryGame(
  db: Db,
  gameData: RegistryGameSeed,
): Promise<void> {
  const { eventTypes, iconUrl: _iconUrl, ...game } = gameData;

  const nameMatch = await findGameByNormalizedName(db, game.name);

  let gameId: number;
  if (nameMatch) {
    // Merge into the name-matched row (shared UPDATE branch below).
    gameId = nameMatch.id;
    console.log(`  🔗 Merged by name: ${game.name} (existing row ${gameId})`);
    await updateGameRow(db, gameId, game);
  } else {
    gameId = await insertOrUpdateBySlug(db, game);
  }

  await insertEventTypes(db, gameId, eventTypes);
}

/** No name match: insert a new row, or merge when the slug already exists. */
async function insertOrUpdateBySlug(
  db: Db,
  game: RegistryGame,
): Promise<number> {
  // ROK-400: Upsert into unified games table (slug is unique)
  const [insertedGame] = await db
    .insert(schema.games)
    .values(game)
    .onConflictDoNothing({ target: schema.games.slug })
    .returning();

  if (insertedGame) {
    console.log(`  ✅ Created game: ${game.name} (${game.slug})`);
    return insertedGame.id;
  }

  const [existing] = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, game.slug))
    .limit(1);
  await updateGameRow(db, existing.id, game);
  return existing.id;
}

/** Update config columns + igdbId if they changed (name-match and slug-hit paths). */
async function updateGameRow(
  db: Db,
  gameId: number,
  game: RegistryGame,
): Promise<void> {
  await db
    .update(schema.games)
    .set({
      ...(game.igdbId ? { igdbId: game.igdbId } : {}),
      shortName: game.shortName,
      colorHex: game.colorHex,
      hasRoles: game.hasRoles,
      hasSpecs: game.hasSpecs,
      maxCharactersPerUser: game.maxCharactersPerUser,
      ...('apiNamespacePrefix' in game
        ? { apiNamespacePrefix: game.apiNamespacePrefix }
        : {}),
      // ROK-1377: keep URL-only / free-to-play metadata current on re-seed.
      ...('websiteUrl' in game ? { websiteUrl: game.websiteUrl } : {}),
      ...('isFreeToPlay' in game ? { isFreeToPlay: game.isFreeToPlay } : {}),
    })
    .where(eq(schema.games.id, gameId));
  console.log(`  🔄 Updated game: ${game.name}`);
}

async function insertEventTypes(
  db: Db,
  gameId: number,
  eventTypes: RegistryEventType[],
): Promise<void> {
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
}

async function bootstrap() {
  console.log('🌱 Seeding game registry...\n');

  const app = await NestFactory.createApplicationContext(SeedModule);
  const db = app.get<Db>(DrizzleAsyncProvider);

  try {
    for (const gameData of GAMES_SEED) {
      await upsertRegistryGame(db, gameData);
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

// Guarded so the unit spec can import upsertRegistryGame without booting Nest.
if (require.main === module) {
  void bootstrap();
}
