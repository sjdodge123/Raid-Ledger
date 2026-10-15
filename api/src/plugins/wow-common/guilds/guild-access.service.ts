import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildSummary, UserRole } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  findLinkedMemberRows,
  toGuildSummary,
  type LinkedMemberRow,
} from './guild-membership.helpers';

/** The caller as the JWT strategy puts it on `request.user`. */
export interface GuildActor {
  id: number;
  role: UserRole;
}

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

/** Admin and operator see and edit every guild. */
export function isStaff(actor: GuildActor): boolean {
  return actor.role === 'admin' || actor.role === 'operator';
}

/**
 * ROK-1785 D4 — the ONLY place guild rank / delegation logic lives. Every
 * answer is computed live from the latest snapshot; nothing is cached, so a
 * GM demoted in-game loses rights at the next import.
 */
@Injectable()
export class GuildAccessService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** D3 membership: a live member row linked via one of the user's characters. */
  async isMember(userId: number, guildId: number): Promise<boolean> {
    const rows = await findLinkedMemberRows(this.db, userId, guildId);
    return rows.length > 0;
  }

  /** Members (read-only) + admin/operator. Non-members cannot view. */
  async canView(actor: GuildActor, guildId: number): Promise<boolean> {
    if (isStaff(actor)) return true;
    return this.isMember(actor.id, guildId);
  }

  /**
   * Admin/operator, or an explicit `guild_editors` grant (rank or member).
   * The GM counts only while `GM_RANK_IMPLIES_EDIT` is on.
   */
  async canEdit(actor: GuildActor, guildId: number): Promise<boolean> {
    if (isStaff(actor)) return true;
    const rows = await findLinkedMemberRows(this.db, actor.id, guildId);
    if (rows.length === 0) return false;
    if (GM_RANK_IMPLIES_EDIT && rows.some(isGuildMaster)) return true;
    return this.hasDelegation(guildId, rows);
  }

  /** Granting/revoking editors: admin/operator only (no DB lookup). */
  canManageEditors(actor: GuildActor, guildId: number): Promise<boolean> {
    void guildId;
    return Promise.resolve(isStaff(actor));
  }

  /** Guilds the user is a member of (nav entry point), by name. */
  async myGuilds(userId: number): Promise<GuildSummary[]> {
    const rows = await findLinkedMemberRows(this.db, userId);
    const ids = [...new Set(rows.map((r) => r.guildId))];
    if (ids.length === 0) return [];
    const guilds = await this.db
      .select()
      .from(schema.guilds)
      .where(inArray(schema.guilds.id, ids))
      .orderBy(asc(schema.guilds.name));
    return guilds.map(toGuildSummary);
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
