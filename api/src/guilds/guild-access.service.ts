import { Inject, Injectable } from '@nestjs/common';
import { asc, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GuildSummary,
  GuildViewerAccess,
  LadderRole,
  UserRole,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import {
  findGuildKind,
  findGuildVisibility,
  toGuildSummary,
  type GuildVisibility,
} from './guild-core.queries';
import { HubKindRegistry } from './hub-kind.registry';

/** The caller as the JWT strategy puts it on `request.user`. */
export interface GuildActor {
  id: number;
  role: UserRole;
}

/** Admin and operator see and edit every guild. */
export function isStaff(actor: GuildActor): boolean {
  return actor.role === 'admin' || actor.role === 'operator';
}

/** ROK-1830 D5-A: edit rights = Leader or Officer (today's `canEdit`). */
export function ladderCanEdit(role: LadderRole): boolean {
  return role === 'leader' || role === 'officer';
}

/** ROK-1830 D5-A: managing editors = Leader only (today's staff check). */
export function ladderCanManageEditors(role: LadderRole): boolean {
  return role === 'leader';
}

/** ROK-1870 D14: an active, unhidden community hub shows visitors its Overview. */
function isOpenCommunityHub(guild: GuildVisibility | null): boolean {
  return (
    guild !== null &&
    guild.kind === 'game_community' &&
    guild.status === 'active' &&
    guild.hiddenAt === null
  );
}

/** The page's `viewer` object, every boolean derived from the ladder role. */
export function viewerAccess(role: LadderRole): GuildViewerAccess {
  return {
    role,
    canEdit: ladderCanEdit(role),
    canManageEditors: ladderCanManageEditors(role),
  };
}

/**
 * ROK-1830 S2b — the game-agnostic half of guild access. Staff rights and the
 * ladder → boolean mapping live here; everything that needs to know what a
 * "member" or a "rank" IS belongs to the hub kind's adapter
 * (`EXTENSION_POINTS.HUB_KIND`), so core never imports a game plugin.
 * Nothing is cached: a demoted GM loses rights at the next import.
 */
@Injectable()
export class GuildAccessService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly hubKinds: HubKindRegistry,
  ) {}

  /** Membership as the group's hub kind defines it; unknown kind ⇒ false. */
  async isMember(userId: number, guildId: number): Promise<boolean> {
    const hub = await this.hubKinds.forGuild(guildId);
    return hub === undefined ? false : hub.isMember(userId, guildId);
  }

  /** Members (read-only) + admin/operator. Non-members cannot view. */
  async canView(actor: GuildActor, guildId: number): Promise<boolean> {
    if (isStaff(actor)) return true;
    return this.isMember(actor.id, guildId);
  }

  /**
   * ROK-1830 D5-A ladder, resolved in ONE place: staff (admin/operator) ⇒
   * leader, no lookup; otherwise the group's hub kind answers. A guild that
   * does not exist has no ladder, so the caller is a visitor; a kind whose
   * owning plugin is inactive is refused by `HubKindRegistry.require`.
   */
  async resolveLadder(actor: GuildActor, guildId: number): Promise<LadderRole> {
    if (isStaff(actor)) return 'leader';
    const kind = await findGuildKind(this.db, guildId);
    if (kind === null) return 'visitor';
    return this.hubKinds.require(kind).resolveLadder(actor, guildId);
  }

  /** Leader or Officer: admin/operator, or an explicit `guild_editors` grant. */
  async canEdit(actor: GuildActor, guildId: number): Promise<boolean> {
    return ladderCanEdit(await this.resolveLadder(actor, guildId));
  }

  /**
   * Granting/revoking editors: Leader only. Today only staff are Leader, so
   * no DB lookup is needed (ROK-1794 makes rank 0 a Leader and this a query).
   */
  canManageEditors(actor: GuildActor, guildId: number): Promise<boolean> {
    void guildId;
    return Promise.resolve(isStaff(actor));
  }

  /**
   * ROK-1870 D14 / OQ-5 — the Overview widgets (leader post, Discord mirror):
   * `canView`, or any signed-in caller on an active, unhidden community hub.
   * Member rows stay member-only (`buildCommunityHubPage`).
   */
  async canReadOverview(actor: GuildActor, guildId: number): Promise<boolean> {
    if (await this.canView(actor, guildId)) return true;
    return isOpenCommunityHub(await findGuildVisibility(this.db, guildId));
  }

  /**
   * The Discord channel binding: staff (`canManageEditors`) on every kind,
   * plus a community hub's ladder Leader (ROK-1870 §2.5). Other kinds stay
   * staff-only, so a WoW GM never rebinds a channel (ROK-1830 D5-A).
   */
  async canManageDiscord(actor: GuildActor, guildId: number): Promise<boolean> {
    if (await this.canManageEditors(actor, guildId)) return true;
    if ((await findGuildKind(this.db, guildId)) !== 'game_community') {
      return false;
    }
    return ladderCanManageEditors(await this.resolveLadder(actor, guildId));
  }

  /** Groups the user belongs to across every live hub kind, by name. */
  async myGuilds(userId: number): Promise<GuildSummary[]> {
    const perKind = await Promise.all(
      this.hubKinds.active().map((hub) => hub.memberGroupIds(userId)),
    );
    const ids = [...new Set(perKind.flat())];
    if (ids.length === 0) return [];
    const guilds = await this.db
      .select()
      .from(schema.guilds)
      .where(inArray(schema.guilds.id, ids))
      .orderBy(asc(schema.guilds.name));
    return guilds.map(toGuildSummary);
  }
}
