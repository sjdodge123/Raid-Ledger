/**
 * ROK-1957 §5.4 — campaign, binding and default-campaign writes. Binding
 * and default changes re-assign the caller's own rows in the same tx (D-6).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, max } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Bg3CampaignSummary } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { Bg3HubLookup, Bg3HubRow } from '../read/bg3-hub-access.helpers';
import { toBg3CampaignSummary } from '../read/bg3-read.mappers';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Bg3CampaignRow {
  id: number;
  guildId: number;
  hostUserId: number | null;
  archivedAt: Date | null;
}

export interface Bg3KeyLocation {
  campaignId: number;
  campaignName: string;
  hubId: number;
  hubName: string;
  saveCount: number;
}

export interface Bg3CampaignPatch {
  name?: string;
  hostUserId?: number;
  /** D-11 soft archive: `true` stamps `archived_at`, `false` clears it. */
  archived?: boolean;
}

const c = schema.bg3Campaigns;
const s = schema.bg3Saves;
const h = schema.bg3HubSettings;

/** Make `campaignId` the hub's active campaign only when it has none (D-11). */
async function activateIfNoneActive(
  tx: Tx,
  guildId: number,
  campaignId: number,
): Promise<void> {
  await tx
    .insert(h)
    .values({ guildId, activeCampaignId: campaignId })
    .onConflictDoUpdate({
      target: h.guildId,
      set: { activeCampaignId: campaignId, updatedAt: new Date() },
      setWhere: isNull(h.activeCampaignId),
    });
}

/** Row-locks campaign `id` (same `c` → `h` lock order as the other writers)
 *  and reports whether it is currently archived. */
async function wasArchived(tx: Tx, id: number): Promise<boolean> {
  const [prior] = await tx
    .select({ archivedAt: c.archivedAt })
    .from(c)
    .where(eq(c.id, id))
    .for('update');
  return prior?.archivedAt != null;
}

@Injectable()
export class Bg3CampaignsRepository implements Bg3HubLookup {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  async findHub(hubId: number): Promise<Bg3HubRow | null> {
    const g = schema.guilds;
    const [row] = await this.db
      .select({
        id: g.id,
        kind: g.kind,
        gameSlug: schema.games.slug,
        gameIgdbId: schema.games.igdbId,
        hiddenAt: g.hiddenAt,
        status: g.status,
      })
      .from(g)
      .leftJoin(schema.games, eq(schema.games.id, g.gameId))
      .where(eq(g.id, hubId))
      .limit(1);
    if (!row) return null;
    const hidden = row.hiddenAt !== null || row.status !== 'active';
    return {
      id: row.id,
      kind: row.kind,
      gameSlug: row.gameSlug,
      gameIgdbId: row.gameIgdbId,
      hidden,
    };
  }

  async findCampaign(id: number): Promise<Bg3CampaignRow | null> {
    const [row] = await this.db
      .select({
        id: c.id,
        guildId: c.guildId,
        hostUserId: c.hostUserId,
        archivedAt: c.archivedAt,
      })
      .from(c)
      .where(eq(c.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Insert; the hub's first campaign (no active one yet) becomes active. */
  async createCampaign(guildId: number, name: string, userId: number) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(c)
        .values({ guildId, name, hostUserId: userId, createdByUserId: userId })
        .returning({ id: c.id });
      if (!row) throw new Error('bg3 campaign insert returned no row');
      await activateIfNoneActive(tx, guildId, row.id);
      return row.id;
    });
  }

  /**
   * D-11: archiving the hub's active campaign clears `activeCampaignId`;
   * unarchiving one (it WAS archived) on a hub with no active campaign makes
   * it active again (the party returns). A hub that already has an active one
   * keeps it, and `archived: false` on an already-live campaign is a no-op.
   *
   * Accepted race: archiving the active A while another tx restores B can
   * leave the hub with no active campaign (B's upsert sees `h = A` and skips,
   * then A's archive clears it). The one-active invariant still holds and an
   * editor can make B active by hand.
   */
  async updateCampaign(id: number, patch: Bg3CampaignPatch): Promise<void> {
    const { archived, ...fields } = patch;
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const restoring = archived === false && (await wasArchived(tx, id));
      const [row] = await tx
        .update(c)
        .set({
          ...fields,
          ...(archived !== undefined
            ? { archivedAt: archived ? now : null }
            : {}),
          updatedAt: now,
        })
        .where(eq(c.id, id))
        .returning({ guildId: c.guildId });
      if (!row || archived === undefined) return;
      if (!archived) {
        if (restoring) await activateIfNoneActive(tx, row.guildId, id);
        return;
      }
      await tx
        .update(h)
        .set({ activeCampaignId: null, updatedAt: now })
        .where(eq(h.activeCampaignId, id));
    });
  }

  async summary(id: number): Promise<Bg3CampaignSummary | null> {
    const [row] = await this.db
      .select({
        id: c.id,
        name: c.name,
        hostUserId: c.hostUserId,
        activeId: h.activeCampaignId,
        lastSavedAt: max(s.savedAt),
        saveCount: count(s.id),
        archivedAt: c.archivedAt,
      })
      .from(c)
      .leftJoin(h, eq(h.guildId, c.guildId))
      .leftJoin(s, eq(s.campaignId, c.id))
      .where(eq(c.id, id))
      .groupBy(c.id, h.activeCampaignId);
    return row ? toBg3CampaignSummary(row) : null;
  }

  async bindKey(userId: number, key: string, campaignId: number) {
    const k = schema.bg3CampaignKeys;
    await this.db.transaction(async (tx) => {
      await tx
        .insert(k)
        .values({ userId, campaignKey: key, campaignId })
        .onConflictDoUpdate({
          target: [k.userId, k.campaignKey],
          set: { campaignId },
        });
      await tx.update(s).set({ campaignId }).where(ownRows(userId, key));
    });
  }

  /** ROK-1960: the caller's binding for `key`, else their latest assigned save's campaign; + their save count. */
  async keyLocation(
    userId: number,
    key: string,
  ): Promise<Bg3KeyLocation | null> {
    const k = schema.bg3CampaignKeys;
    const g = schema.guilds;
    const cols = {
      campaignId: c.id,
      campaignName: c.name,
      hubId: g.id,
      hubName: g.name,
    };
    const [bound] = await this.db
      .select(cols)
      .from(k)
      .innerJoin(c, eq(c.id, k.campaignId))
      .innerJoin(g, eq(g.id, c.guildId))
      .where(and(eq(k.userId, userId), eq(k.campaignKey, key)))
      .limit(1);
    const [latest] = bound
      ? [bound]
      : await this.db
          .select(cols)
          .from(s)
          .innerJoin(c, eq(c.id, s.campaignId))
          .innerJoin(g, eq(g.id, c.guildId))
          .where(ownRows(userId, key))
          .orderBy(desc(s.savedAt))
          .limit(1);
    if (!latest) return null;
    const [n] = await this.db
      .select({ n: count() })
      .from(s)
      .where(ownRows(userId, key));
    return { ...latest, saveCount: n?.n ?? 0 };
  }

  async unbindKey(userId: number, key: string): Promise<void> {
    const k = schema.bg3CampaignKeys;
    await this.db.transaction(async (tx) => {
      await tx
        .delete(k)
        .where(and(eq(k.userId, userId), eq(k.campaignKey, key)));
      await tx.update(s).set({ campaignId: null }).where(ownRows(userId, key));
    });
  }

  /**
   * Upsert (and assign the caller's unassigned rows) or delete. Returns
   * `false` — writing nothing — when the campaign is archived (D-11); the
   * row is locked `FOR UPDATE` so a concurrent archive cannot slip between
   * the check and the write.
   */
  async setDefault(userId: number, campaignId: number | null) {
    const d = schema.bg3UserDefaults;
    if (campaignId === null) {
      await this.db.delete(d).where(eq(d.userId, userId));
      return true;
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ archivedAt: c.archivedAt })
        .from(c)
        .where(eq(c.id, campaignId))
        .limit(1)
        .for('update');
      if (!row || row.archivedAt) return false;
      await tx
        .insert(d)
        .values({ userId, campaignId })
        .onConflictDoUpdate({
          target: d.userId,
          set: { campaignId, updatedAt: new Date() },
        });
      await tx
        .update(s)
        .set({ campaignId })
        .where(and(eq(s.uploaderUserId, userId), isNull(s.campaignId)));
      return true;
    });
  }
}

function ownRows(userId: number, key: string) {
  return and(eq(s.uploaderUserId, userId), eq(s.campaignKey, key));
}
