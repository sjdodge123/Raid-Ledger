/**
 * ROK-1957 §5.2 — the ingest writes for `bg3-save`. Every method runs on
 * the ingest transaction it is handed (C3 owns it; a throw rolls the whole
 * message back), never on the outer db.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { CompanionDeviceTx } from '../../../companion/devices/companion-device-lock';
import { liveCommunityRole } from '../../../guilds/community/community-hub.reads';

/** A campaign an incoming save may be assigned to, with its hub. */
export interface Bg3CampaignTarget {
  id: number;
  guildId: number;
}

/** One `bg3_saves` insert. */
export type Bg3SaveInsert = typeof schema.bg3Saves.$inferInsert;

@Injectable()
export class Bg3SavesWriteRepository {
  /**
   * D-6: the uploader's binding for `campaignKey`, else their default
   * campaign, else null (the save stays unassigned).
   */
  async resolveCampaign(
    tx: CompanionDeviceTx,
    userId: number,
    campaignKey: string,
  ): Promise<Bg3CampaignTarget | null> {
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
   * a no-op. Returns whether a row was written.
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
