/**
 * ROK-2234 — the Minecraft: Bedrock Edition `games` row. The Java row is
 * IGDB-seeded (`games-seed.json`, IGDB 121); Bedrock has no verified IGDB id,
 * so it rides the boot seed (`GAMES_SEED`) with `igdbId: null` and the plugin
 * re-ensures it on install/activate.
 *
 * Both go through `upsertSeedGame`, the existing games INSERT path: inside
 * `withGameNameLock` it takes the slug row, else merges into a same-name row
 * (`findGameByNormalizedName`, stamping the slug), else inserts — one
 * statement per branch, no catch-and-retry inside the transaction.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  upsertSeedGame,
  type SeedGameAction,
} from '../../games-lookup/seed-games.helpers';
import {
  MINECRAFT_BEDROCK_GAME_NAME,
  MINECRAFT_BEDROCK_GAME_SLUG,
} from './minecraft.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** The `games` columns the plugin owns for the Bedrock row. */
export const MINECRAFT_BEDROCK_GAME = {
  igdbId: null,
  slug: MINECRAFT_BEDROCK_GAME_SLUG,
  name: MINECRAFT_BEDROCK_GAME_NAME,
} as const;

/** Find-or-create the Bedrock row under the games name lock (idempotent). */
export async function ensureMinecraftBedrockGame(
  db: Db,
): Promise<{ id: number; action: SeedGameAction }> {
  return upsertSeedGame(db, { ...MINECRAFT_BEDROCK_GAME });
}
