/**
 * ROK-1957 §5.4/§5.6/§5.7 — save-level reads: one save for the thumbnail
 * routes, the uploader's own list (`me/saves`) and the ROK-1959 gallery feed.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { BG3_GAME_SLUGS, BG3_IGDB_ID } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { HubMediaCursor } from '../../../hub-media/hub-media.cursor';
import { pickCanonical } from '../history/bg3-canonical.helpers';
import { BG3_NEWEST_FIRST } from './bg3-read.repository';

type Db = PostgresJsDatabase<typeof schema>;
const c = schema.bg3Campaigns;
const s = schema.bg3Saves;
const u = schema.users;

const CANONICAL_COLS = {
  id: s.id,
  uploaderUserId: s.uploaderUserId,
  campaignKey: s.campaignKey,
  savedAt: s.savedAt,
};

/** A save in a campaign, with the hub + host canonical checks need. */
export interface Bg3SaveRef {
  id: number;
  uploaderUserId: number;
  campaignKey: string;
  savedAt: Date;
  campaignId: number;
  guildId: number;
  hostUserId: number | null;
  thumbnailSha256: string | null;
}

/** D-7: is `save` the canonical row among its `(campaignKey, savedAt)` twins? */
export async function isCanonicalSave(
  saves: Pick<Bg3SavesReadRepository, 'twins'>,
  save: Bg3SaveRef,
): Promise<boolean> {
  const twins = await saves.twins(
    save.campaignId,
    save.campaignKey,
    save.savedAt,
  );
  return pickCanonical(twins, save.hostUserId)[0]?.id === save.id;
}

export interface Bg3MySavesQuery {
  unassigned: boolean;
  cursor: HubMediaCursor | null;
  limit: number;
}

@Injectable()
export class Bg3SavesReadRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  async saveInCampaign(saveId: number): Promise<Bg3SaveRef | null> {
    const [row] = await this.db
      .select({
        ...CANONICAL_COLS,
        campaignId: c.id,
        guildId: c.guildId,
        hostUserId: c.hostUserId,
        thumbnailSha256: s.thumbnailSha256,
      })
      .from(s)
      .innerJoin(c, eq(c.id, s.campaignId))
      .where(eq(s.id, saveId))
      .limit(1);
    return row ?? null;
  }

  /** Rows of the campaign sharing `(campaignKey, savedAt)` — D-7 twins. */
  twins(campaignId: number, campaignKey: string, savedAt: Date) {
    return this.db
      .select(CANONICAL_COLS)
      .from(s)
      .where(
        and(
          eq(s.campaignId, campaignId),
          eq(s.campaignKey, campaignKey),
          eq(s.savedAt, savedAt),
        ),
      );
  }

  mySaves(userId: number, q: Bg3MySavesQuery) {
    const where: (SQL | undefined)[] = [eq(s.uploaderUserId, userId)];
    if (q.unassigned) where.push(isNull(s.campaignId));
    if (q.cursor) where.push(before(q.cursor));
    return this.db
      .select({
        id: s.id,
        saveName: s.saveName,
        savedAt: s.savedAt,
        campaignKey: s.campaignKey,
        campaignKeySource: s.campaignKeySource,
        campaignId: s.campaignId,
        currentLevel: s.currentLevel,
        thumbnailSha256: s.thumbnailSha256,
      })
      .from(s)
      .where(and(...where))
      .orderBy(...BG3_NEWEST_FIRST)
      .limit(q.limit);
  }

  async defaultCampaignId(userId: number): Promise<number | null> {
    const d = schema.bg3UserDefaults;
    const [row] = await this.db
      .select({ campaignId: d.campaignId })
      .from(d)
      .where(eq(d.userId, userId))
      .limit(1);
    return row?.campaignId ?? null;
  }

  /** The caller's own save's thumbnail sha (null: not theirs / none). */
  async ownThumbnail(userId: number, saveId: number): Promise<string | null> {
    const [row] = await this.db
      .select({ sha: s.thumbnailSha256 })
      .from(s)
      .where(and(eq(s.id, saveId), eq(s.uploaderUserId, userId)))
      .limit(1);
    return row?.sha ?? null;
  }

  /** BG3 community hubs with at least one non-archived campaign (1959 ask 3). */
  async bg3HubIds(): Promise<number[]> {
    const g = schema.guilds;
    const rows = await this.db
      .selectDistinct({ id: c.guildId })
      .from(c)
      .innerJoin(g, eq(g.id, c.guildId))
      .innerJoin(schema.games, eq(schema.games.id, g.gameId))
      .where(
        and(
          isNull(c.archivedAt),
          eq(g.kind, 'game_community'),
          or(
            inArray(schema.games.slug, [...BG3_GAME_SLUGS]),
            eq(schema.games.igdbId, BG3_IGDB_ID),
          ),
        ),
      );
    return rows.map((r) => r.id);
  }

  /** Every assigned save of the hub's campaigns (optionally since a time). */
  feedRows(guildId: number, since?: Date) {
    const where = [eq(c.guildId, guildId)];
    if (since) where.push(gt(s.savedAt, since));
    return this.db
      .select({
        ...CANONICAL_COLS,
        campaignId: c.id,
        hostUserId: c.hostUserId,
        area: s.currentLevel,
        sha256: s.thumbnailSha256,
        displayName: u.displayName,
        username: u.username,
      })
      .from(s)
      .innerJoin(c, eq(c.id, s.campaignId))
      .innerJoin(u, eq(u.id, s.uploaderUserId))
      .where(and(...where));
  }
}

/** Strictly after `cursor` in `(savedAt DESC, id DESC)` order. */
function before(cursor: HubMediaCursor): SQL | undefined {
  return or(
    lt(s.savedAt, cursor.capturedAt),
    and(eq(s.savedAt, cursor.capturedAt), lt(s.id, cursor.id)),
  );
}
