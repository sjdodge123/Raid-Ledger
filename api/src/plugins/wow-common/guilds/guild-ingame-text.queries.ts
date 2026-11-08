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
const motdEditor = alias(schema.users, 'ingame_motd_editor');
const infoEditor = alias(schema.users, 'ingame_info_editor');

/** `timestamptz` → `YYYY-MM-DDTHH:MI:SS.USZ` (null stays null). */
const utcText = (col: AnyColumn) =>
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
 * Ensure the guild's profile row exists (a guild with no profile yet is still
 * writable), then lock it for the save and return the stored texts + tokens.
 */
export async function lockIngameText(
  tx: Tx,
  guildId: number,
): Promise<StoredIngameTexts> {
  await tx.insert(profiles).values({ guildId }).onConflictDoNothing();
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

/** Write only the changed fields' columns (the patch is never empty). */
export async function writeIngameText(
  tx: Tx,
  guildId: number,
  patch: IngameTextPatch,
): Promise<void> {
  await tx.update(profiles).set(patch).where(eq(profiles.guildId, guildId));
}
