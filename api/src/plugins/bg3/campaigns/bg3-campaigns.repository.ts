/**
 * ROK-1957 §5.4 — campaign, binding and default-campaign writes. Binding
 * and default changes re-assign the caller's own rows in the same tx (D-6).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, isNull, max } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Bg3CampaignSummary } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { Bg3HubLookup, Bg3HubRow } from '../read/bg3-hub-access.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export interface Bg3CampaignRow {
  id: number;
  guildId: number;
  hostUserId: number | null;
}

export interface Bg3CampaignPatch {
  name?: string;
  hostUserId?: number;
}

const c = schema.bg3Campaigns;
const s = schema.bg3Saves;
const h = schema.bg3HubSettings;

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
        hiddenAt: g.hiddenAt,
        status: g.status,
      })
      .from(g)
      .leftJoin(schema.games, eq(schema.games.id, g.gameId))
      .where(eq(g.id, hubId))
      .limit(1);
    if (!row) return null;
    const hidden = row.hiddenAt !== null || row.status !== 'active';
    return { id: row.id, kind: row.kind, gameSlug: row.gameSlug, hidden };
  }

  async findCampaign(id: number): Promise<Bg3CampaignRow | null> {
    const [row] = await this.db
      .select({ id: c.id, guildId: c.guildId, hostUserId: c.hostUserId })
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
      await tx
        .insert(h)
        .values({ guildId, activeCampaignId: row.id })
        .onConflictDoUpdate({
          target: h.guildId,
          set: { activeCampaignId: row.id, updatedAt: new Date() },
          setWhere: isNull(h.activeCampaignId),
        });
      return row.id;
    });
  }

  async updateCampaign(id: number, patch: Bg3CampaignPatch): Promise<void> {
    await this.db
      .update(c)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(c.id, id));
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
      })
      .from(c)
      .leftJoin(h, eq(h.guildId, c.guildId))
      .leftJoin(s, eq(s.campaignId, c.id))
      .where(eq(c.id, id))
      .groupBy(c.id, h.activeCampaignId);
    if (!row) return null;
    const { activeId, lastSavedAt, ...rest } = row;
    return {
      ...rest,
      isActive: activeId === row.id,
      lastSavedAt: lastSavedAt ? lastSavedAt.toISOString() : null,
    };
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

  async unbindKey(userId: number, key: string): Promise<void> {
    const k = schema.bg3CampaignKeys;
    await this.db.transaction(async (tx) => {
      await tx
        .delete(k)
        .where(and(eq(k.userId, userId), eq(k.campaignKey, key)));
      await tx.update(s).set({ campaignId: null }).where(ownRows(userId, key));
    });
  }

  /** Upsert (and assign the caller's unassigned rows) or delete. */
  async setDefault(userId: number, campaignId: number | null) {
    const d = schema.bg3UserDefaults;
    if (campaignId === null) {
      await this.db.delete(d).where(eq(d.userId, userId));
      return;
    }
    await this.db.transaction(async (tx) => {
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
    });
  }
}

function ownRows(userId: number, key: string) {
  return and(eq(s.uploaderUserId, userId), eq(s.campaignKey, key));
}
