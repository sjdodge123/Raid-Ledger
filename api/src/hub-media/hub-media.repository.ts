import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const { hubMedia } = schema;
/** A tombstoned row whose files are still on disk. */
export interface HubMediaRemovedFile {
  guildId: number;
  storageName: string;
}
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

/**
 * Advisory-lock class for the per-hub byte cap. The two-`int4` form's
 * keyspace is disjoint from the one-`bigint` form; the games name lock uses
 * class 1438, so the two never collide.
 */
export const HUB_MEDIA_CAP_LOCK_CLASS = 1942;

/**
 * Run `fn` in a transaction holding a per-hub advisory lock, so the cap read
 * and the insert are one step: parallel ingests for one hub queue here
 * instead of each reading the same `bytesUsed` and all inserting. Use the
 * `tx` handed in — work on the outer `db` runs on another connection.
 */
export async function withHubMediaCapLock<T>(
  db: Db,
  guildId: number,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${HUB_MEDIA_CAP_LOCK_CLASS}::int4, ${guildId}::int4)`,
    );
    return fn(tx);
  });
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
  where: {
    guildId: number;
    provenanceKey?: string;
    id?: number;
    /** ROK-1959 review — data withdrawn: drop who/what, keep only the key. */
    scrub?: boolean;
  },
): Promise<string | null> {
  const match =
    where.id !== undefined
      ? eq(hubMedia.id, where.id)
      : eq(hubMedia.provenanceKey, where.provenanceKey ?? '');
  const scrubbed = where.scrub
    ? { authorName: null, caption: null, uploadedBy: null }
    : {};
  const [row] = await db
    .update(hubMedia)
    .set({ removedAt: new Date(), ...scrubbed })
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

/**
 * ROK-1959 — which of `keys` already exist on the hub, live OR tombstoned
 * (a removed picture is never re-added). Empty `keys` → no query.
 */
export async function existingKeys(
  db: Db,
  guildId: number,
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db
    .select({ key: hubMedia.provenanceKey })
    .from(hubMedia)
    .where(
      and(
        eq(hubMedia.guildId, guildId),
        inArray(hubMedia.provenanceKey, [...keys]),
      ),
    );
  return new Set(rows.map((r) => r.key));
}

/** ROK-1959 D-9 — a member's live rows from one source, across every hub. */
export async function liveRowsBySourceAndUploader(
  db: Db,
  source: string,
  userId: number,
): Promise<{ id: number; guildId: number }[]> {
  return db
    .select({ id: hubMedia.id, guildId: hubMedia.guildId })
    .from(hubMedia)
    .where(
      and(
        eq(hubMedia.source, source),
        eq(hubMedia.uploadedBy, userId),
        isNull(hubMedia.removedAt),
      ),
    );
}

/**
 * ROK-2068 — tombstone + scrub the member's live rows from one source whose
 * provenance key is in `keys`, on every hub, in ONE statement that cannot
 * violate a constraint, so a caller runs it inside its own transaction.
 * Returns each row's hub + storage name; unlink the files AFTER commit.
 */
export async function tombstoneSourceRowsByKeys(
  db: Db | Tx,
  source: string,
  userId: number,
  keys: readonly string[],
): Promise<HubMediaRemovedFile[]> {
  if (keys.length === 0) return [];
  return db
    .update(hubMedia)
    .set({
      removedAt: new Date(),
      authorName: null,
      caption: null,
      uploadedBy: null,
    })
    .where(
      and(
        eq(hubMedia.source, source),
        eq(hubMedia.uploadedBy, userId),
        inArray(hubMedia.provenanceKey, [...keys]),
        isNull(hubMedia.removedAt),
      ),
    )
    .returning({
      guildId: hubMedia.guildId,
      storageName: hubMedia.storageName,
    });
}
