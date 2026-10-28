/**
 * ROK-1957 §5.6 — hub-scoped BG3 reads: campaign list, settings, the rows
 * a snapshot or session list is built from, and party claims. Session
 * reads select columns only (never `party`); canonical dedupe happens in TS.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, max } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  Bg3CampaignSummary,
  Bg3HubSettings,
  Bg3HubSettingsBody,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { Bg3RetentionRow } from '../history/bg3-retention.helpers';
import { toBg3CampaignSummary } from './bg3-read.mappers';

type Db = PostgresJsDatabase<typeof schema>;
const c = schema.bg3Campaigns;
const s = schema.bg3Saves;
const h = schema.bg3HubSettings;

/**
 * Newest-first order of a campaign's saves (D-8; index `(campaign_id,
 * saved_at DESC, id DESC)`). The snapshot and the claim slot check both use
 * it, so a savedAt tie picks the same party in both.
 */
/** `ok`, or the 400 message a refused active campaign answers with. */
export type Bg3SettingsWrite =
  'ok' | 'campaign_not_in_hub' | 'campaign_archived';

export const BG3_NEWEST_FIRST = [desc(s.savedAt), desc(s.id)] as const;

/** A save as session clustering + `pickCanonical` need it (no party). */
export interface Bg3SaveLiteRow extends Bg3RetentionRow {
  uploaderUserId: number;
  campaignKey: string;
}

export interface Bg3SnapshotRow extends Bg3SaveLiteRow {
  saveName: string;
  receivedAt: Date;
  difficulty: string;
  ruleset: string | null;
  gameVersion: string;
  platform: string;
  party: unknown;
  /** `display_name ?? username` of the uploader (D-8); null if the user row is gone. */
  uploaderDisplayName: string | null;
}

export interface Bg3ClaimView {
  slotKey: string;
  userId: number;
  displayName: string;
  avatarUrl: string | null;
}

export const SAVE_LITE_COLS = {
  id: s.id,
  uploaderUserId: s.uploaderUserId,
  campaignKey: s.campaignKey,
  savedAt: s.savedAt,
  sessionFirstSavedAt: s.sessionFirstSavedAt,
  sessionSaveCount: s.sessionSaveCount,
  currentLevel: s.currentLevel,
  partyMaxLevel: s.partyMaxLevel,
  thumbnailSha256: s.thumbnailSha256,
};

const SNAPSHOT_COLS = {
  ...SAVE_LITE_COLS,
  saveName: s.saveName,
  receivedAt: s.receivedAt,
  difficulty: s.difficulty,
  ruleset: s.ruleset,
  gameVersion: s.gameVersion,
  platform: s.platform,
  party: s.party,
};

const DEFAULT_SETTINGS: Bg3HubSettings = {
  hideLocationAndScreenshots: false,
  activeCampaignId: null,
};

@Injectable()
export class Bg3ReadRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  async hubCampaigns(guildId: number): Promise<Bg3CampaignSummary[]> {
    const rows = await this.db
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
      .where(eq(c.guildId, guildId))
      .groupBy(c.id, h.activeCampaignId)
      .orderBy(asc(c.id));
    return rows.map(toBg3CampaignSummary);
  }

  async settings(guildId: number): Promise<Bg3HubSettings> {
    const [row] = await this.db
      .select({
        hideLocationAndScreenshots: h.hideLocationAndScreenshots,
        activeCampaignId: h.activeCampaignId,
      })
      .from(h)
      .where(eq(h.guildId, guildId))
      .limit(1);
    return row ?? DEFAULT_SETTINGS;
  }

  /**
   * D-11: the active campaign is checked and written in ONE transaction. The
   * campaign row is locked `FOR UPDATE`, so a concurrent archive (which
   * updates that row first, then clears `activeCampaignId`) either commits
   * before the check (→ `campaign_archived`) or waits and then clears what we
   * wrote. A pre-check, never catch-and-retry (a failed statement poisons the tx).
   */
  async upsertSettings(
    guildId: number,
    patch: Bg3HubSettingsBody,
    userId: number,
  ): Promise<Bg3SettingsWrite> {
    const set = { ...patch, updatedByUserId: userId, updatedAt: new Date() };
    return this.db.transaction(async (tx) => {
      const active = patch.activeCampaignId;
      if (active != null) {
        const [row] = await tx
          .select({ archivedAt: c.archivedAt })
          .from(c)
          .where(and(eq(c.id, active), eq(c.guildId, guildId)))
          .limit(1)
          .for('update');
        if (!row) return 'campaign_not_in_hub';
        if (row.archivedAt) return 'campaign_archived';
      }
      await tx
        .insert(h)
        .values({ guildId, ...set })
        .onConflictDoUpdate({ target: h.guildId, set });
      return 'ok';
    });
  }

  async campaignInHub(campaignId: number, guildId: number) {
    const [row] = await this.db
      .select({ id: c.id, hostUserId: c.hostUserId, archivedAt: c.archivedAt })
      .from(c)
      .where(and(eq(c.id, campaignId), eq(c.guildId, guildId)))
      .limit(1);
    return row ?? null;
  }

  /** Every assigned row of the campaign (bounded by retention, D-9). */
  sessionRows(campaignId: number): Promise<Bg3SaveLiteRow[]> {
    return this.db
      .select(SAVE_LITE_COLS)
      .from(s)
      .where(eq(s.campaignId, campaignId));
  }

  /** The newest `limit` rows, newest first, with party. */
  async snapshotRows(
    campaignId: number,
    limit: number,
  ): Promise<Bg3SnapshotRow[]> {
    const u = schema.users;
    const rows = await this.db
      .select({
        ...SNAPSHOT_COLS,
        displayName: u.displayName,
        username: u.username,
      })
      .from(s)
      .leftJoin(u, eq(u.id, s.uploaderUserId))
      .where(eq(s.campaignId, campaignId))
      .orderBy(...BG3_NEWEST_FIRST)
      .limit(limit);
    return rows.map(({ displayName, username, ...rest }) => ({
      ...rest,
      uploaderDisplayName: displayName ?? username,
    }));
  }

  async claims(campaignId: number): Promise<Bg3ClaimView[]> {
    const k = schema.bg3PartyClaims;
    const u = schema.users;
    const rows = await this.db
      .select({
        slotKey: k.slotKey,
        userId: k.userId,
        displayName: u.displayName,
        username: u.username,
        avatarUrl: u.customAvatarUrl,
      })
      .from(k)
      .innerJoin(u, eq(u.id, k.userId))
      .where(eq(k.campaignId, campaignId));
    return rows.map(({ displayName, username, ...rest }) => ({
      ...rest,
      displayName: displayName ?? username,
    }));
  }
}
