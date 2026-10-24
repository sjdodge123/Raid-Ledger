/**
 * ROK-1948 — the recipes fixture's spoiler-protection presets. The Planner
 * shows only what SOME character on the server has discovered (every
 * profile's `known_recipes`, claimed or not), so the seed adds an unclaimed
 * scout (`c3`) who knows the whole demo set: by default nothing is hidden and
 * the owner still lacks Bronze sword (ROK-1862's chip). `early` and `none`
 * then overwrite EVERY profile on the server.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '../../../drizzle/schema';
import { upsertArmoryProfile } from './valheim-armory-demo-seed.helpers';
import { RECIPES_DEMO_ALL_KNOWN } from './valheim-armory-recipes-demo-seed.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const RecipesSpoilersPresetSchema = z.enum(['all', 'early', 'none']);
export type RecipesSpoilersPreset = z.infer<typeof RecipesSpoilersPresetSchema>;

/** The unclaimed character whose list unlocks the whole demo set. */
export const RECIPES_DEMO_SCOUT_KEY = 'c3';

/**
 * `early` (AC1): Workbench + Club, plus the Bronze-needing Cultivator so a
 * plan meets an undiscovered ingredient. Forge, Bronze, Bronze sword, the
 * processors and their outputs are hidden.
 */
export const RECIPES_DEMO_EARLY_KNOWN: readonly string[] = [
  'piece_workbench',
  'Club',
  'Cultivator',
];

/** Upsert the unclaimed scout and give it every demo prefab. */
export async function seedRecipesDemoScout(
  db: Db,
  serverId: number,
  worker: number,
): Promise<number> {
  const id = await upsertArmoryProfile(db, serverId, {
    slot: worker,
    key: RECIPES_DEMO_SCOUT_KEY,
    claimedBy: null,
    withCatalog: false,
    extraRows: false,
  });
  const P = schema.valheimProfiles;
  await db
    .update(P)
    .set({ knownRecipes: [...RECIPES_DEMO_ALL_KNOWN], importedAt: sql`now()` })
    .where(eq(P.id, id));
  return id;
}

/**
 * `early` / `none` overwrite every list on the server; `all` keeps them.
 * Every write bumps `imported_at` as a real re-import does, so the Planner's
 * visible-graph cache key (profile fingerprint) moves with the preset.
 */
export async function applyRecipesSpoilersPreset(
  db: Db,
  serverId: number,
  preset: RecipesSpoilersPreset,
): Promise<void> {
  if (preset === 'all') return;
  const knownRecipes = preset === 'early' ? [...RECIPES_DEMO_EARLY_KNOWN] : [];
  const P = schema.valheimProfiles;
  await db
    .update(P)
    .set({ knownRecipes, knownItems: [], importedAt: sql`now()` })
    .where(eq(P.pelicanServerId, serverId));
}
