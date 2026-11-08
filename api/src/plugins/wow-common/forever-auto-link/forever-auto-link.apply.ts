/**
 * ROK-2124: the database + Blizzard steps of a Forever Armory auto-link.
 * The service sequences them; each function is one query or one fetch so
 * the service's unit spec can mock this module wholesale.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type { CharacterSyncAdapter } from '../../plugin-host/extension-points';
import {
  buildSyncUpdateFieldsFromSync,
  fetchFullProfile,
  type EnrichedProfile,
} from '../../../characters/characters-sync.helpers';
import { resolveNsPrefix } from '../../../characters/characters-crud.helpers';
import { WOW_FOREVER_GAME_SLUG } from '../wow-forever-identity.helpers';
import { WOW_FOREVER_VARIANT } from '../forever-armory-switch';
import {
  autoLinkCandidateWhere,
  autoLinkDueWhere,
  autoLinkOrderBy,
  nextRetryAt,
  type AutoLinkErrorKind,
} from './forever-auto-link.helpers';

type Db = PostgresJsDatabase<typeof schema>;
/** A `characters` row as the auto-link reads it. */
export type AutoLinkCharacter = typeof schema.characters.$inferSelect;
type StateRow = typeof schema.wowForeverArmoryAutolink.$inferSelect;

/** A character plus its auto-link state row (null = never attempted). */
export interface AutoLinkTarget {
  row: AutoLinkCharacter;
  state: StateRow | null;
}

/** The WoW: Forever `games.id`, or null when the game is not seeded. */
export async function findForeverGameId(db: Db): Promise<number | null> {
  const [game] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  return game?.id ?? null;
}

/** Re-read one character with its state row (undefined when deleted). */
export async function loadAutoLinkTarget(
  db: Db,
  characterId: string,
): Promise<AutoLinkTarget | undefined> {
  const s = schema.wowForeverArmoryAutolink;
  const [hit] = await db
    .select({ row: schema.characters, state: s })
    .from(schema.characters)
    .leftJoin(s, eq(s.characterId, schema.characters.id))
    .where(eq(schema.characters.id, characterId))
    .limit(1);
  return hit;
}

/** Ids of due candidates, oldest-first, at most `limit`. */
export async function listDueCandidateIds(
  db: Db,
  foreverGameId: number,
  now: Date,
  limit: number,
): Promise<string[]> {
  const s = schema.wowForeverArmoryAutolink;
  const rows = await db
    .select({ id: schema.characters.id })
    .from(schema.characters)
    .leftJoin(s, eq(s.characterId, schema.characters.id))
    .where(and(autoLinkCandidateWhere(foreverGameId), autoLinkDueWhere(now)))
    .orderBy(...autoLinkOrderBy())
    .limit(limit);
  return rows.map((r) => r.id);
}

/** The same calls an Armory import makes, for a realmless Forever row. */
export async function fetchForeverProfile(
  db: Db,
  adapter: CharacterSyncAdapter,
  row: AutoLinkCharacter,
): Promise<EnrichedProfile> {
  const region = row.region ?? '';
  const nsPrefix = await resolveNsPrefix(db, row.gameId);
  return fetchFullProfile(adapter, row.name, null, region, nsPrefix);
}

/** Id of ANOTHER row (same game + region) already holding `externalId`. */
export async function findExternalIdHolder(
  db: Db,
  row: AutoLinkCharacter,
  externalId: string,
): Promise<string | null> {
  const c = schema.characters;
  const region = row.region ?? '';
  const [hit] = await db
    .select({ id: c.id })
    .from(c)
    .where(
      and(
        eq(c.gameId, row.gameId),
        eq(c.region, region),
        eq(c.externalId, externalId),
        ne(c.id, row.id),
      ),
    )
    .limit(1);
  return hit?.id ?? null;
}

/**
 * Link the row (compare-and-set on `game_variant IS NULL`) and drop its
 * state row. Never writes name, ruleset, isMain, addon_guid or userId.
 * @returns false when a concurrent Armory import already linked it.
 */
export async function applyAutoLink(
  db: Db,
  row: AutoLinkCharacter,
  fetched: EnrichedProfile,
): Promise<boolean> {
  const c = schema.characters;
  const externalId = fetched.profile.externalId || null;
  const fields = buildSyncUpdateFieldsFromSync(fetched.profile, fetched, {
    ...(row.region ? { region: row.region } : {}),
    gameVariant: WOW_FOREVER_VARIANT,
  });
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(c)
      .set({ ...fields, ...(externalId !== null ? { externalId } : {}) })
      .where(and(eq(c.id, row.id), isNull(c.gameVariant)))
      .returning({ id: c.id });
    // Linked here or by a racing import: either way no longer a candidate.
    const s = schema.wowForeverArmoryAutolink;
    await tx.delete(s).where(eq(s.characterId, row.id));
    return updated.length > 0;
  });
}

/** Upsert the state row after failure number `failures`. */
export async function recordAutoLinkFailure(
  db: Db,
  characterId: string,
  failures: number,
  kind: AutoLinkErrorKind,
  now: Date,
): Promise<void> {
  const s = schema.wowForeverArmoryAutolink;
  const values = {
    failures,
    retryAt: nextRetryAt(failures, now),
    lastError: kind,
    lastAttemptAt: now,
  };
  await db
    .insert(s)
    .values({ characterId, ...values })
    .onConflictDoUpdate({ target: s.characterId, set: values });
}
