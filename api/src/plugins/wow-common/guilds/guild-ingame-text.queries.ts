/**
 * ROK-2136 — the guild's in-game MOTD / Guild Information columns on
 * `guild_profiles` (no access logic). Each `*_updated_at` is a per-field
 * concurrency token (D6), so it is read as the DB's own microsecond UTC text —
 * a JS `Date` would round it.
 */
import { eq, sql, type AnyColumn } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type {
  IngameTextPatch,
  IngameTextRow,
  StoredIngameTexts,
} from './guild-ingame-text.helpers';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const { guildProfiles: profiles } = schema;

/** `pg_advisory_xact_lock(ns, guildId)` namespace for in-game text saves. */
const INGAME_TEXT_LOCK_NS = 2136;
const motdEditor = alias(schema.users, 'ingame_motd_editor');
const infoEditor = alias(schema.users, 'ingame_info_editor');

/** `timestamptz` → `YYYY-MM-DDTHH:MI:SS.USZ` (null stays null). */
export const utcText = (col: AnyColumn) =>
  sql<
    string | null
  >`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const motdUpdatedAt = utcText(profiles.ingameMotdUpdatedAt);
const infoUpdatedAt = utcText(profiles.ingameInfoUpdatedAt);

/** The two fields with their editors' names; null when no profile row. */
export async function findIngameText(
  db: Db,
  guildId: number,
): Promise<IngameTextRow | null> {
  const [row] = await db
    .select({
      motd: profiles.ingameMotd,
      motdUpdatedAt,
      motdEditor: sql<
        string | null
      >`coalesce(${motdEditor.displayName}, ${motdEditor.username})`,
      info: profiles.ingameInfo,
      infoUpdatedAt,
      infoEditor: sql<
        string | null
      >`coalesce(${infoEditor.displayName}, ${infoEditor.username})`,
    })
    .from(profiles)
    .leftJoin(motdEditor, eq(motdEditor.id, profiles.ingameMotdUpdatedBy))
    .leftJoin(infoEditor, eq(infoEditor.id, profiles.ingameInfoUpdatedBy))
    .where(eq(profiles.guildId, guildId));
  return row ?? null;
}

/**
 * Serialise saves for the guild (an advisory lock — a guild with no profile
 * row yet has nothing to `FOR UPDATE`), then lock the row if it exists and
 * return the stored texts + tokens. Inserts nothing: a no-op save or a 409
 * leaves no `guild_profiles` row behind.
 */
export async function lockIngameText(
  tx: Tx,
  guildId: number,
): Promise<StoredIngameTexts> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${INGAME_TEXT_LOCK_NS}::int4, ${guildId}::int4)`,
  );
  const [row] = await tx
    .select({
      motd: profiles.ingameMotd,
      motdUpdatedAt,
      info: profiles.ingameInfo,
      infoUpdatedAt,
    })
    .from(profiles)
    .where(eq(profiles.guildId, guildId))
    .for('update');
  return {
    motd: { text: row?.motd ?? null, updatedAt: row?.motdUpdatedAt ?? null },
    info: { text: row?.info ?? null, updatedAt: row?.infoUpdatedAt ?? null },
  };
}

/**
 * Write only the changed fields' columns (the patch is never empty). Upserts:
 * the profile row is created here, on the first real change, never earlier.
 */
export async function writeIngameText(
  tx: Tx,
  guildId: number,
  patch: IngameTextPatch,
): Promise<void> {
  await tx
    .insert(profiles)
    .values({ guildId, ...patch })
    .onConflictDoUpdate({ target: profiles.guildId, set: patch });
}
