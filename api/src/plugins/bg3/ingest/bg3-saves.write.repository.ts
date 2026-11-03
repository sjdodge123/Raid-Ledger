/**
 * ROK-1957 §5.2 — the ingest writes for `bg3-save`. Every method runs on
 * the ingest transaction it is handed (C3 owns it; a throw rolls the whole
 * message back), never on the outer db.
 */
import { Injectable } from '@nestjs/common';
import type { Bg3SaveMessage } from '@raid-ledger/contract';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { CompanionDeviceTx } from '../../../companion/devices/companion-device-lock';
import { liveCommunityRole } from '../../../guilds/community/community-hub.reads';
import { lockBg3UserCampaigns } from '../campaigns/bg3-campaign-lock';

/** A campaign an incoming save may be assigned to, with its hub. */
export interface Bg3CampaignTarget {
  id: number;
  guildId: number;
}

/** One `bg3_saves` insert. */
export type Bg3SaveInsert = typeof schema.bg3Saves.$inferInsert;

/** The identity of one incoming save, as {@link saveAlreadyHeld} reads it. */
export type Bg3SaveIdentity = Pick<
  Bg3SaveMessage['payload'],
  'campaignKey' | 'campaignKeySource' | 'saveName' | 'savedAt'
>;

/**
 * ROK-2070 OQ3 + M1: does the uploader already hold this save? Either the
 * exact `(campaignKey, savedAt)` the unique index guards (a replay, which an
 * old pre-B1 marker no longer catches), or the same save under another key:
 * same `saveName` and `savedAt` to the second (m1 — producers may differ in
 * sub-second precision), with the same key or another key source (a folder
 * key re-sent with its GameID key, or a bare-`.lsv` file-name key). A plain
 * read on the ingest tx — never catch-and-retry, which would poison it.
 */
export async function saveAlreadyHeld(
  tx: CompanionDeviceTx,
  userId: number,
  p: Bg3SaveIdentity,
): Promise<boolean> {
  const s = schema.bg3Saves;
  const at = new Date(p.savedAt);
  const sameSecond = sql`date_trunc('second', ${s.savedAt}) = date_trunc('second', ${at.toISOString()}::timestamptz)`;
  const [held] = await tx
    .select({ id: s.id })
    .from(s)
    .where(
      and(
        eq(s.uploaderUserId, userId),
        or(
          and(eq(s.campaignKey, p.campaignKey), eq(s.savedAt, at)),
          and(
            eq(s.saveName, p.saveName),
            sameSecond,
            or(
              eq(s.campaignKey, p.campaignKey),
              ne(s.campaignKeySource, p.campaignKeySource),
            ),
          ),
        ),
      ),
    )
    .limit(1);
  return held !== undefined;
}

@Injectable()
export class Bg3SavesWriteRepository {
  /**
   * D-6: the uploader's binding for `campaignKey`, else their default
   * campaign, else null (the save stays unassigned).
   *
   * ROK-1960 F5: takes the per-user campaign lock FIRST. It is a tx lock, so
   * it holds through `insertSave` to the ingest commit — a bind/unbind/
   * default change cannot re-file rows between this read and the insert.
   * Taken here (not at message start) to keep the lock's scope to the
   * resolution + row write.
   *
   * Per-user order (F5b + P2-3): blob lock → gallery lock → markers lock
   * (`lockBg3UserMarkers`, taken before the 11c marker write) → marker rows
   * → THIS campaign lock → key / default / save rows. Never take the markers
   * lock after this one.
   */
  async resolveCampaign(
    tx: CompanionDeviceTx,
    userId: number,
    campaignKey: string,
  ): Promise<Bg3CampaignTarget | null> {
    await lockBg3UserCampaigns(tx, userId);
    const c = schema.bg3Campaigns;
    const k = schema.bg3CampaignKeys;
    const [bound] = await tx
      .select({ id: c.id, guildId: c.guildId })
      .from(k)
      .innerJoin(c, eq(c.id, k.campaignId))
      .where(and(eq(k.userId, userId), eq(k.campaignKey, campaignKey)))
      .limit(1);
    if (bound) return bound;
    const d = schema.bg3UserDefaults;
    const [fallback] = await tx
      .select({ id: c.id, guildId: c.guildId })
      .from(d)
      .innerJoin(c, eq(c.id, d.campaignId))
      // D-11: an archived default resolves as "no default" (save unassigned).
      .where(and(eq(d.userId, userId), isNull(c.archivedAt)))
      .limit(1);
    return fallback ?? null;
  }

  /**
   * D-2/D-6: is the uploader a live member of the campaign's hub? BG3 hubs
   * are `game_community` hubs only, so this is the community-hub `isMember`
   * gate — read on the ingest tx (a second pool connection while the tx
   * holds one deadlocks `DB_POOL_MAX=1`).
   */
  async isHubMember(
    tx: CompanionDeviceTx,
    userId: number,
    guildId: number,
  ): Promise<boolean> {
    return (await liveCommunityRole(tx, guildId, userId)) !== null;
  }

  /**
   * D-4: insert one save; a replay of `(uploader, campaignKey, savedAt)` is
   * a no-op (a backstop: ingest has already acked an already-held save
   * `stale` via {@link saveAlreadyHeld} before its marker moved, ROK-2070
   * M1). Returns whether a row was written.
   */
  async insertSave(
    tx: CompanionDeviceTx,
    row: Bg3SaveInsert,
  ): Promise<boolean> {
    const s = schema.bg3Saves;
    const written = await tx
      .insert(s)
      .values(row)
      .onConflictDoNothing({
        target: [s.uploaderUserId, s.campaignKey, s.savedAt],
      })
      .returning({ id: s.id });
    return written.length > 0;
  }
}
