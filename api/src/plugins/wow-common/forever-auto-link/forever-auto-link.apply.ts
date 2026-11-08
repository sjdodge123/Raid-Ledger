/**
 * ROK-2124: the database + Blizzard steps of a Forever Armory auto-link.
 * The service sequences them; each function is one query or one fetch so
 * the service's unit spec can mock this module wholesale.
 */
import { and, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
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
  AUTOLINK_CLAIM_LEASE_MS,
  autoLinkCandidateWhere,
  autoLinkDueWhere,
  autoLinkOrderBy,
  retryAtFor,
  type AutoLinkErrorKind,
} from './forever-auto-link.helpers';

type Db = PostgresJsDatabase<typeof schema>;
/** A `characters` row as the auto-link reads it. */
export type AutoLinkCharacter = typeof schema.characters.$inferSelect;
/** A candidate after `isAutoLinkCandidateShape` narrowed its region. */
export type RegionedCharacter = AutoLinkCharacter & { region: string };
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
  row: RegionedCharacter,
): Promise<EnrichedProfile> {
  const nsPrefix = await resolveNsPrefix(db, row.gameId);
  return fetchFullProfile(adapter, row.name, null, row.region, nsPrefix);
}

/**
 * Claim one attempt atomically: insert the state row, or push an existing
 * one's `retry_at` a lease ahead only while it is due (or parked as an
 * `invalid_name` — the service only claims one once the name is fixed). The
 * import nudge and the hourly job both claim, so at most one of them fetches
 * a character. Nothing is claimed for a row that is no longer a candidate
 * (see {@link candidateSource}).
 * @returns the stored failure count, or null when another attempt holds it.
 */
export async function claimAutoLinkAttempt(
  db: Db,
  characterId: string,
  now: Date,
): Promise<number | null> {
  const retryAt = new Date(now.getTime() + AUTOLINK_CLAIM_LEASE_MS);
  const rows = await db.execute<{ failures: number }>(sql`
    INSERT INTO wow_forever_armory_autolink
      (character_id, failures, retry_at, last_error, last_attempt_at)
    ${candidateSource(characterId, 0, retryAt, 'in_flight', now)}
    ON CONFLICT (character_id) DO UPDATE SET
      retry_at = excluded.retry_at,
      last_error = excluded.last_error,
      last_attempt_at = excluded.last_attempt_at
    WHERE wow_forever_armory_autolink.retry_at <= ${now.toISOString()}::timestamptz
      OR wow_forever_armory_autolink.last_error = 'invalid_name'
    RETURNING failures`);
  const [claimed] = rows;
  return claimed ? Number(claimed.failures) : null;
}

/**
 * The one-row SELECT feeding a state-row upsert, empty once the character
 * is gone or Armory-linked (`game_variant` set — the same compare-and-set
 * `applyAutoLink` uses). `FOR UPDATE` serialises it against a concurrent
 * link, so a late attempt never writes an orphan state row onto a linked
 * character.
 */
function candidateSource(
  characterId: string,
  failures: number,
  retryAt: Date,
  lastError: string,
  now: Date,
): SQL {
  return sql`
    SELECT id, ${failures}::smallint, ${retryAt.toISOString()}::timestamptz,
      ${lastError}, ${now.toISOString()}::timestamptz
    FROM characters
    WHERE id = ${characterId} AND game_variant IS NULL
    FOR UPDATE`;
}

/** Id of ANOTHER row (same game + region) already holding `externalId`. */
export async function findExternalIdHolder(
  db: Db,
  row: RegionedCharacter,
  externalId: string,
): Promise<string | null> {
  const c = schema.characters;
  const [hit] = await db
    .select({ id: c.id })
    .from(c)
    .where(
      and(
        eq(c.gameId, row.gameId),
        eq(c.region, row.region),
        eq(c.externalId, externalId),
        ne(c.id, row.id),
      ),
    )
    .limit(1);
  return hit?.id ?? null;
}

/**
 * Link the row (compare-and-set on `game_variant IS NULL` AND the stored
 * name still being the one fetched) and drop its state row. Never writes
 * name, ruleset, isMain, addon_guid or userId.
 * @returns false when a concurrent Armory import already linked it, or the
 *   character was renamed mid-fetch (the next run fetches the new name).
 */
export async function applyAutoLink(
  db: Db,
  row: RegionedCharacter,
  fetched: EnrichedProfile,
): Promise<boolean> {
  const c = schema.characters;
  const externalId = fetched.profile.externalId || null;
  const fields = buildSyncUpdateFieldsFromSync(fetched.profile, fetched, {
    region: row.region,
    gameVariant: WOW_FOREVER_VARIANT,
  });
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(c)
      .set({ ...fields, ...(externalId !== null ? { externalId } : {}) })
      .where(and(eq(c.id, row.id), isNull(c.gameVariant), eq(c.name, row.name)))
      .returning({ id: c.id });
    // Linked here or by a racing import: either way no longer a candidate.
    const s = schema.wowForeverArmoryAutolink;
    await tx.delete(s).where(eq(s.characterId, row.id));
    return updated.length > 0;
  });
}

/** Upsert the state row after failure number `failures` (candidates only). */
export async function recordAutoLinkFailure(
  db: Db,
  characterId: string,
  failures: number,
  kind: AutoLinkErrorKind,
  now: Date,
): Promise<void> {
  const retryAt = retryAtFor(kind, failures, now);
  await db.execute(sql`
    INSERT INTO wow_forever_armory_autolink
      (character_id, failures, retry_at, last_error, last_attempt_at)
    ${candidateSource(characterId, failures, retryAt, kind, now)}
    ON CONFLICT (character_id) DO UPDATE SET
      failures = excluded.failures,
      retry_at = excluded.retry_at,
      last_error = excluded.last_error,
      last_attempt_at = excluded.last_attempt_at`);
}
