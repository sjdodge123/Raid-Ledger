import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
const { hubMedia } = schema;
export type HubMediaInsert = typeof hubMedia.$inferInsert;

/** The row for a key — live or tombstoned — so a duplicate skips the download. */
export async function findByKey(
  db: Db,
  guildId: number,
  provenanceKey: string,
): Promise<{ id: number; removedAt: Date | null } | undefined> {
  const [row] = await db
    .select({ id: hubMedia.id, removedAt: hubMedia.removedAt })
    .from(hubMedia)
    .where(
      and(
        eq(hubMedia.guildId, guildId),
        eq(hubMedia.provenanceKey, provenanceKey),
      ),
    )
    .limit(1);
  return row;
}

/**
 * One statement that cannot violate the unique index (D2): `null` when a
 * concurrent ingest of the same key won the race.
 */
export async function insertIgnore(
  db: Db,
  values: HubMediaInsert,
): Promise<number | null> {
  const [row] = await db
    .insert(hubMedia)
    .values(values)
    .onConflictDoNothing({ target: [hubMedia.guildId, hubMedia.provenanceKey] })
    .returning({ id: hubMedia.id });
  return row?.id ?? null;
}

/** Bytes the hub's live pictures occupy on disk (the D6 cap). */
export async function bytesUsed(db: Db, guildId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${hubMedia.bytes}), 0)` })
    .from(hubMedia)
    .where(and(eq(hubMedia.guildId, guildId), isNull(hubMedia.removedAt)));
  return Number(row?.total ?? 0);
}

/** Tombstone a live row (D8); returns its storage name for the unlink, else `null`. */
export async function markRemoved(
  db: Db,
  where: { guildId: number; provenanceKey?: string; id?: number },
): Promise<string | null> {
  const match =
    where.id !== undefined
      ? eq(hubMedia.id, where.id)
      : eq(hubMedia.provenanceKey, where.provenanceKey ?? '');
  const [row] = await db
    .update(hubMedia)
    .set({ removedAt: new Date() })
    .where(
      and(
        eq(hubMedia.guildId, where.guildId),
        match,
        isNull(hubMedia.removedAt),
      ),
    )
    .returning({ storageName: hubMedia.storageName });
  return row?.storageName ?? null;
}
