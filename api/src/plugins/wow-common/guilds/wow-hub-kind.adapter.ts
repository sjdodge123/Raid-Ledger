import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildKind, LadderRole } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { HubKindAdapter } from '../../plugin-host/extension-points';
import { isStaff, type GuildActor } from '../../../guilds/guild-access.service';
import { WOW_COMMON_MANIFEST } from '../manifest';
import {
  findLinkedMemberRows,
  isLiveMemberOf,
  type LinkedMemberRow,
} from './guild-membership.helpers';
import { rankNamesInSnapshot } from './guild-queries.helpers';

/** The guild master is rank 0 — the only built-in rank meaning (spec §3). */
export const GM_RANK_INDEX = 0;

/**
 * SECURITY (ROK-1785 review, Lead decision pending the operator): rank 0 does
 * NOT imply edit rights. Member GUIDs are claimed first-come from unsigned
 * LedgerLink exports, so anyone could claim the GM's GUID. Until the follow-up
 * "verify character ownership" story ships, the GM edits only through an
 * explicit `guild_editors` grant made by an admin/operator. Flipping this to
 * `true` restores implicit GM edit rights (managing editors stays staff-only).
 */
export const GM_RANK_IMPLIES_EDIT = false;

/**
 * ROK-1830: WoW registers itself as the `wow_guild` hub kind. Membership is
 * a live linked roster row (ROK-1785 D3); the ladder is the rank/delegation
 * rule — the ONLY place WoW guild rank / delegation logic lives. Computed
 * live from the latest snapshot, never cached, so a GM demoted in-game loses
 * rights at the next import.
 */
@Injectable()
export class WowHubKindAdapter implements HubKindAdapter {
  readonly kind: GuildKind = 'wow_guild';
  readonly pluginSlug: string = WOW_COMMON_MANIFEST.id;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async isMember(userId: number, guildId: number): Promise<boolean> {
    const rows = await findLinkedMemberRows(this.db, userId, guildId);
    return rows.length > 0;
  }

  /**
   * Until ROK-1794: staff ⇒ leader; an explicit `guild_editors` grant (rank
   * or member) ⇒ officer — the GM counts only while `GM_RANK_IMPLIES_EDIT` is
   * on; any other live linked member ⇒ member; everyone else ⇒ visitor.
   */
  async resolveLadder(actor: GuildActor, guildId: number): Promise<LadderRole> {
    if (isStaff(actor)) return 'leader';
    const rows = await findLinkedMemberRows(this.db, actor.id, guildId);
    if (rows.length === 0) return 'visitor';
    if (GM_RANK_IMPLIES_EDIT && rows.some(isGuildMaster)) return 'officer';
    const delegated = await this.hasDelegation(guildId, rows);
    return delegated ? 'officer' : 'member';
  }

  async memberGroupIds(userId: number): Promise<number[]> {
    const rows = await findLinkedMemberRows(this.db, userId);
    return [...new Set(rows.map((r) => r.guildId))];
  }

  rankNames(guildId: number): Promise<Map<number, string | null>> {
    return rankNamesInSnapshot(this.db, guildId);
  }

  isLiveMember(guildId: number, memberId: number): Promise<boolean> {
    return isLiveMemberOf(this.db, guildId, memberId);
  }

  private async hasDelegation(
    guildId: number,
    rows: LinkedMemberRow[],
  ): Promise<boolean> {
    const { guildEditors: ge } = schema;
    const ranks = rows.flatMap((r) =>
      r.rankIndex === null ? [] : [r.rankIndex],
    );
    const memberIds = rows.map((r) => r.memberId);
    const target = or(
      ranks.length > 0 ? inArray(ge.rankIndex, ranks) : undefined,
      inArray(ge.guildMemberId, memberIds),
    );
    const grants = await this.db
      .select({ id: ge.id })
      .from(ge)
      .where(and(eq(ge.guildId, guildId), target));
    return grants.length > 0;
  }
}

function isGuildMaster(row: LinkedMemberRow): boolean {
  return row.rankIndex === GM_RANK_INDEX;
}
