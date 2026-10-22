import { and, desc, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { DbOrTx } from '../community-membership.queries';

/** ROK-1893 P1 — `hub_invites` reads/writes (db or an open transaction). */

const i = schema.hubInvites;
const u = schema.users;
const g = schema.guilds;

/** One invite row plus its maker's display fields (null when deleted). */
export interface InviteWithMaker {
  invite: schema.HubInviteSelect;
  maker: { id: number; displayName: string } | null;
}

/** Live = not revoked, not expired, uses left (matches `inviteState`). */
export function liveInvitePredicate(now: Date): SQL | undefined {
  return and(
    isNull(i.revokedAt),
    or(isNull(i.expiresAt), gt(i.expiresAt, now)),
    or(isNull(i.maxUses), sql`${i.useCount} < ${i.maxUses}`),
  );
}

/** The maker's live links on the hub (the per-member cap). */
export async function countLiveByMaker(
  db: DbOrTx,
  hubId: number,
  userId: number,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(i)
    .where(
      and(
        eq(i.guildId, hubId),
        eq(i.createdBy, userId),
        liveInvitePredicate(now),
      ),
    );
  return row?.n ?? 0;
}

/** Insert one link; returns the row. */
export async function insertInvite(
  db: DbOrTx,
  values: schema.HubInviteInsert,
): Promise<schema.HubInviteSelect> {
  const [row] = await db.insert(i).values(values).returning();
  if (!row)
    throw new Error(`hub ${values.guildId} invite insert returned nothing`);
  return row;
}

/** The hub's links (all, or only `makerId`'s), newest first, with makers. */
export async function listInvites(
  db: DbOrTx,
  hubId: number,
  makerId: number | null,
): Promise<InviteWithMaker[]> {
  const where =
    makerId === null
      ? eq(i.guildId, hubId)
      : and(eq(i.guildId, hubId), eq(i.createdBy, makerId));
  const rows = await db
    .select({
      invite: i,
      makerId: u.id,
      makerName: sql<string | null>`COALESCE(${u.displayName}, ${u.username})`,
    })
    .from(i)
    .leftJoin(u, eq(u.id, i.createdBy))
    .where(where)
    .orderBy(desc(i.createdAt), desc(i.id))
    .limit(200);
  return rows.map((r) => ({
    invite: r.invite,
    maker:
      r.makerId === null
        ? null
        : { id: r.makerId, displayName: r.makerName ?? '' },
  }));
}

/** One link of the hub by id, or null. */
export async function findInvite(
  db: DbOrTx,
  hubId: number,
  inviteId: number,
): Promise<schema.HubInviteSelect | null> {
  const [row] = await db
    .select()
    .from(i)
    .where(and(eq(i.guildId, hubId), eq(i.id, inviteId)));
  return row ?? null;
}

/** One link by token; `lock` takes `FOR UPDATE` (run inside a tx). */
export async function findInviteByToken(
  db: DbOrTx,
  token: string,
  lock = false,
): Promise<schema.HubInviteSelect | null> {
  const q = db.select().from(i).where(eq(i.token, token));
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

/** Revoke (idempotent: an already-revoked link keeps its first time). */
export async function revokeInvite(
  db: DbOrTx,
  inviteId: number,
): Promise<void> {
  await db
    .update(i)
    .set({ revokedAt: new Date() })
    .where(and(eq(i.id, inviteId), isNull(i.revokedAt)));
}

/** A redemption that created a new live membership. */
export async function bumpUseCount(
  db: DbOrTx,
  inviteId: number,
): Promise<void> {
  await db
    .update(i)
    .set({ useCount: sql`${i.useCount} + 1` })
    .where(eq(i.id, inviteId));
}

/** Revoke every open link the user made (one hub, or every hub). */
export async function revokeUserInvites(
  db: DbOrTx,
  userId: number,
  hubId?: number,
): Promise<void> {
  const mine = and(eq(i.createdBy, userId), isNull(i.revokedAt));
  await db
    .update(i)
    .set({ revokedAt: new Date() })
    .where(hubId === undefined ? mine : and(mine, eq(i.guildId, hubId)));
}

/** The preview's hub card fields + availability inputs. */
export interface PreviewHubRow {
  id: number;
  name: string;
  kind: string;
  status: string;
  hiddenAt: Date | null;
  blurb: string | null;
  memberCount: number;
  gameName: string | null;
  gameCoverUrl: string | null;
}

/** The hub behind a link, with its game's name and cover. */
export async function loadPreviewHub(
  db: DbOrTx,
  hubId: number,
): Promise<PreviewHubRow | null> {
  const [row] = await db
    .select({
      id: g.id,
      name: g.name,
      kind: g.kind,
      status: g.status,
      hiddenAt: g.hiddenAt,
      blurb: g.blurb,
      memberCount: g.memberCount,
      gameName: schema.games.name,
      gameCoverUrl: schema.games.coverUrl,
    })
    .from(g)
    .leftJoin(schema.games, eq(schema.games.id, g.gameId))
    .where(eq(g.id, hubId))
    .limit(1);
  return row ?? null;
}
