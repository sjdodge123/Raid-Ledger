/**
 * ROK-2187 — reads and writes of `gg_snapshots`. A read never recomputes
 * (AC1): every owner/public path here returns the stored row only.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GgSnapshotV1 } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { ggSnapshots, users } from '../../../drizzle/schema';
import type { GgSnapshotRow } from '../../../drizzle/schema/gg-snapshots';
import { mintGgShareSlug } from './gg-window.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Insert or overwrite the user's snapshot for `snapshot.year`
 * (UNIQUE(user_id, year)). Share and DM columns are left untouched.
 */
export async function upsertGgSnapshot(
  db: Db,
  userId: number,
  snapshot: GgSnapshotV1,
): Promise<void> {
  const values = {
    schemaVersion: snapshot.schemaVersion,
    payload: snapshot,
    activityTier: snapshot.tier,
    computedAt: new Date(snapshot.computedAt),
  };
  await db
    .insert(ggSnapshots)
    .values({ userId, year: snapshot.year, ...values })
    .onConflictDoUpdate({
      target: [ggSnapshots.userId, ggSnapshots.year],
      set: values,
    });
}

/** The stored snapshot row of `userId` for `year`, if any. */
export async function findGgSnapshot(
  db: Db,
  userId: number,
  year: number,
): Promise<GgSnapshotRow | undefined> {
  const [row] = await db
    .select()
    .from(ggSnapshots)
    .where(and(eq(ggSnapshots.userId, userId), eq(ggSnapshots.year, year)));
  return row;
}

/** One archive entry (R5) — no payload. */
export interface GgArchiveRow {
  year: number;
  activityTier: GgSnapshotRow['activityTier'];
  computedAt: Date;
  shareSlug: string | null;
}

/** Every year `userId` has a snapshot for, newest first. */
export async function listGgArchive(
  db: Db,
  userId: number,
): Promise<GgArchiveRow[]> {
  return db
    .select({
      year: ggSnapshots.year,
      activityTier: ggSnapshots.activityTier,
      computedAt: ggSnapshots.computedAt,
      shareSlug: ggSnapshots.shareSlug,
    })
    .from(ggSnapshots)
    .where(eq(ggSnapshots.userId, userId))
    .orderBy(desc(ggSnapshots.year));
}

/** Share columns of one snapshot. */
export type GgShareRow = Pick<GgSnapshotRow, 'shareSlug' | 'sharedAt'>;

/**
 * Turn sharing on (keeps an existing slug, else mints one) or off (nulls
 * slug + shared_at, so the next share mints a NEW slug — Q5). `undefined`
 * when the user has no snapshot for `year`.
 */
export async function setGgShare(
  db: Db,
  userId: number,
  year: number,
  shared: boolean,
): Promise<GgShareRow | undefined> {
  const set = shared
    ? {
        shareSlug: sql`coalesce(${ggSnapshots.shareSlug}, ${mintGgShareSlug()})`,
        sharedAt: sql`coalesce(${ggSnapshots.sharedAt}, now())`,
      }
    : { shareSlug: null, sharedAt: null };
  const [row] = await db
    .update(ggSnapshots)
    .set(set)
    .where(and(eq(ggSnapshots.userId, userId), eq(ggSnapshots.year, year)))
    .returning({
      shareSlug: ggSnapshots.shareSlug,
      sharedAt: ggSnapshots.sharedAt,
    });
  return row;
}

/** A shared snapshot plus the owner's public-facing profile fields. */
export interface GgPublicRow {
  year: number;
  payload: GgSnapshotRow['payload'];
  /** Cache key for the share PNG — the frozen snapshot's compute time. */
  computedAt: Date;
  displayName: string | null;
  username: string;
  avatar: string | null;
  customAvatarUrl: string | null;
}

/** The shared snapshot behind `slug`; `undefined` if unshared/deactivated. */
export async function findGgPublic(
  db: Db,
  slug: string,
): Promise<GgPublicRow | undefined> {
  const [row] = await db
    .select({
      year: ggSnapshots.year,
      payload: ggSnapshots.payload,
      computedAt: ggSnapshots.computedAt,
      displayName: users.displayName,
      username: users.username,
      avatar: users.avatar,
      customAvatarUrl: users.customAvatarUrl,
    })
    .from(ggSnapshots)
    .innerJoin(users, eq(users.id, ggSnapshots.userId))
    .where(and(eq(ggSnapshots.shareSlug, slug), isNull(users.deactivatedAt)));
  return row;
}
