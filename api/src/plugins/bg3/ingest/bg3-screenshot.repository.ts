/**
 * ROK-1966 — the reads and the store write behind `bg3-screenshot` v1. The
 * ingest calls run on the ingest transaction they are handed (C3 owns it; a
 * second pooled connection while it holds one deadlocks `DB_POOL_MAX=1`);
 * the `/config` reads run on the pool.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import {
  liveMemberPredicate,
  type DbOrTx,
} from '../../../guilds/community/community-membership.queries';
import { encodeHubMedia } from '../../../hub-media/hub-media.encode';
import {
  unlinkMediaFiles,
  writeMediaFiles,
} from '../../../hub-media/hub-media.files';
import { HUB_MEDIA_CAP_LOCK_CLASS } from '../../../hub-media/hub-media.repository';
import {
  hubMediaCapBytes,
  toRow,
  type HubMediaStoreRow,
} from '../../../hub-media/hub-media-store.helpers';
import { bg3GameCondition } from '../bg3-game-match.helpers';

const g = schema.guilds;
const m = schema.hubCommunityMembers;
const u = schema.users;
const media = schema.hubMedia;

/** Content-addressed per hub: a replay of the same WebP is a no-op. */
export function bg3ScreenshotProvenanceKey(sha256: string): string {
  return `bg3-screenshot:sha256:${sha256}`;
}

/** Live member + active hub + active user (the community `isMember` gate). */
function liveBg3Membership(userId: number) {
  return and(
    eq(m.userId, userId),
    liveMemberPredicate(),
    eq(g.status, 'active'),
    eq(g.kind, 'game_community'),
    isNull(u.deactivatedAt),
    bg3GameCondition(),
  );
}

/** The BG3 hubs `userId` is a live member of, by name. */
export async function memberBg3Hubs(
  db: DbOrTx,
  userId: number,
): Promise<{ guildId: number; name: string }[]> {
  return db
    .select({ guildId: g.id, name: g.name })
    .from(m)
    .innerJoin(g, eq(g.id, m.guildId))
    .innerJoin(u, eq(u.id, m.userId))
    .innerJoin(schema.games, eq(schema.games.id, g.gameId))
    .where(liveBg3Membership(userId))
    .orderBy(g.name, g.id);
}

/**
 * Q3 refusal gate: is `guildId` an active BG3 `game_community` hub that
 * `userId` is a live member of? One read on the ingest tx.
 */
export async function isLiveBg3HubMember(
  db: DbOrTx,
  userId: number,
  guildId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: g.id })
    .from(m)
    .innerJoin(g, eq(g.id, m.guildId))
    .innerJoin(u, eq(u.id, m.userId))
    .innerJoin(schema.games, eq(schema.games.id, g.gameId))
    .where(and(eq(m.guildId, guildId), liveBg3Membership(userId)))
    .limit(1);
  return row !== undefined;
}

/** The hub of the campaign the uploader's most recent save is filed under. */
export async function latestSaveHubId(
  db: DbOrTx,
  userId: number,
): Promise<number | null> {
  const s = schema.bg3Saves;
  const c = schema.bg3Campaigns;
  const [row] = await db
    .select({ guildId: c.guildId })
    .from(s)
    .innerJoin(c, eq(c.id, s.campaignId))
    .where(and(eq(s.uploaderUserId, userId), isNull(c.archivedAt)))
    .orderBy(desc(s.savedAt), desc(s.id))
    .limit(1);
  return row?.guildId ?? null;
}

/** Any row (live or tombstoned — a Removed screenshot is never re-added). */
export async function screenshotHeld(
  db: DbOrTx,
  guildId: number,
  provenanceKey: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: media.id })
    .from(media)
    .where(
      and(eq(media.guildId, guildId), eq(media.provenanceKey, provenanceKey)),
    )
    .limit(1);
  return row !== undefined;
}

/** The uploader's display name for the Gallery caption line. */
export async function uploaderName(
  db: DbOrTx,
  userId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ displayName: u.displayName, username: u.username })
    .from(u)
    .where(eq(u.id, userId))
    .limit(1);
  return row ? (row.displayName ?? row.username) : null;
}

export type Bg3ScreenshotStoreOutcome =
  'stored' | 'duplicate' | 'cap' | 'not_image';

/**
 * Encode + write the files, then insert the row on the ingest tx under the
 * per-hub cap lock (`pg_advisory_xact_lock`, held to commit — the same lock
 * `HubMediaService` takes). A losing insert unlinks its files.
 */
export async function storeBg3Screenshot(
  tx: DbOrTx,
  row: HubMediaStoreRow,
  raw: Buffer,
): Promise<Bg3ScreenshotStoreOutcome> {
  const encoded = await encodeHubMedia(raw);
  if (!encoded) return 'not_image';
  const storageName = randomUUID();
  const insert = toRow(row, encoded, storageName);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${HUB_MEDIA_CAP_LOCK_CLASS}::int4, ${row.guildId}::int4)`,
  );
  if ((await bytesUsedOn(tx, row.guildId)) + insert.bytes > hubMediaCapBytes())
    return 'cap';
  await writeMediaFiles(row.guildId, storageName, encoded.full, encoded.thumb);
  let written: { id: number } | undefined;
  try {
    [written] = await tx
      .insert(media)
      .values(insert)
      .onConflictDoNothing({ target: [media.guildId, media.provenanceKey] })
      .returning({ id: media.id });
  } catch (err) {
    await unlinkMediaFiles(row.guildId, storageName);
    throw err;
  }
  if (written) return 'stored';
  await unlinkMediaFiles(row.guildId, storageName);
  return 'duplicate';
}

async function bytesUsedOn(db: DbOrTx, guildId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${media.bytes}), 0)` })
    .from(media)
    .where(and(eq(media.guildId, guildId), isNull(media.removedAt)));
  return Number(row?.total ?? 0);
}
