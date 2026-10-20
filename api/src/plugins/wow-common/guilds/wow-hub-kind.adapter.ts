import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GuildKind,
  GuildPage,
  GuildRaidsDto,
  LadderRole,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type {
  HubEditorGrant,
  HubEditorStatus,
  HubKindAdapter,
  HubMineRank,
} from '../../plugin-host/extension-points';
import { isStaff, type GuildActor } from '../../../guilds/guild-access.service';
import { WOW_COMMON_MANIFEST } from '../manifest';
import {
  findLinkedMemberRows,
  findLinkedMemberUserIds,
  isLiveMemberOf,
  type LinkedMemberRow,
} from './guild-membership.helpers';
import { hasDelegation } from './guild-delegation.helpers';
import { editorGrantStatus } from './guild-editor-status.helpers';
import { rankNamesInSnapshot } from './guild-queries.helpers';
import { GuildPageService } from './guild-page.service';
import { GuildRaidsService } from './guild-raids.service';

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
    private readonly pages: GuildPageService,
    private readonly raidsSvc: GuildRaidsService,
  ) {}

  /** ROK-1831: core `GET guilds/:id` — WoW's page, unchanged. */
  page(actor: GuildActor, guildId: number): Promise<GuildPage> {
    return this.pages.page(actor, guildId);
  }

  /** ROK-1831: core `GET guilds/:id/raids` — WoW's raids, unchanged. */
  raids(actor: GuildActor, guildId: number): Promise<GuildRaidsDto> {
    return this.raidsSvc.raids(actor, guildId);
  }

  /** ROK-1831: core `GET guilds/mine` rank columns. */
  mineRanks(
    userId: number,
    guildIds: number[],
  ): Promise<Map<number, HubMineRank>> {
    return this.pages.mineRanks(userId, guildIds);
  }

  async isMember(userId: number, guildId: number): Promise<boolean> {
    const rows = await findLinkedMemberRows(this.db, userId, guildId);
    return rows.length > 0;
  }

  /**
   * Until ROK-1794 verifies ownership: staff ⇒ leader; a staff-confirmed
   * member grant ⇒ officer (rank grants and the GM count only behind their
   * flags — `guild-delegation.helpers.ts`); any other live linked member ⇒
   * member; everyone else ⇒ visitor.
   */
  async resolveLadder(actor: GuildActor, guildId: number): Promise<LadderRole> {
    if (isStaff(actor)) return 'leader';
    const rows = await findLinkedMemberRows(this.db, actor.id, guildId);
    if (rows.length === 0) return 'visitor';
    if (GM_RANK_IMPLIES_EDIT && rows.some(isGuildMaster)) return 'officer';
    const delegated = await hasDelegation(this.db, guildId, rows);
    return delegated ? 'officer' : 'member';
  }

  /** ROK-1832 D8: distinct owners of the guild's live linked member rows. */
  memberUserIds(guildId: number): Promise<number[]> {
    return findLinkedMemberUserIds(this.db, guildId);
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

  /** ROK-1794 (review): whether each grant confers rights, and to whom. */
  editorStatus(
    guildId: number,
    grants: HubEditorGrant[],
  ): Promise<Map<number, HubEditorStatus>> {
    return editorGrantStatus(this.db, guildId, grants);
  }
}

function isGuildMaster(row: LinkedMemberRow): boolean {
  return row.rankIndex === GM_RANK_INDEX;
}
