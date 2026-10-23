import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GuildKind,
  GuildPage,
  GuildRaidsDto,
  LadderRole,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { isStaff, type GuildActor } from '../../../guilds/guild-access.service';
import {
  findGuild,
  findHubGuild,
  hubSummaryFor,
} from '../../../guilds/guild-core.queries';
import { loadCommunityHubEvents } from '../../../guilds/community/community-events.queries';
import type { HubKindAdapter } from '../../plugin-host/extension-points';
import { PELICAN_PLUGIN_ID } from '../pelican.constants';
import {
  isServerHubMemberRow,
  memberServerHubIds,
  serverHubMemberUserIds,
} from './server-hub-membership.queries';
import { ServerHubMembershipService } from './server-hub-membership.service';
import { buildServerHubPage } from './server-hub-page.helpers';
import {
  claimedOnlineSteamIds,
  loadServerBlock,
  loadServerMembers,
} from './server-hub-page.queries';
import { VALHEIM_GAME_SLUG } from '../../valheim/valheim.constants';

/**
 * ROK-1831 L-1: Pelican owns the `game_server` hub kind. Ladder (v1, no
 * Officers): staff ⇒ leader, member (L-2 window) ⇒ member, else visitor. Any
 * signed-in user may open a visible server hub's page — a visitor needs it to
 * press Join; hidden hubs are refused upstream (`HubVisibleGuard`).
 */
@Injectable()
export class PelicanHubKindAdapter implements HubKindAdapter {
  readonly kind: GuildKind = 'game_server';
  readonly pluginSlug: string = PELICAN_PLUGIN_ID;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly membership: ServerHubMembershipService,
  ) {}

  isMember(userId: number, guildId: number): Promise<boolean> {
    return isServerHubMemberRow(this.db, guildId, userId, new Date());
  }

  async resolveLadder(actor: GuildActor, guildId: number): Promise<LadderRole> {
    if (isStaff(actor)) return 'leader';
    return (await this.isMember(actor.id, guildId)) ? 'member' : 'visitor';
  }

  /** ROK-1832 D8: the hub's current members (same L-2 window as isMember). */
  memberUserIds(guildId: number): Promise<number[]> {
    return serverHubMemberUserIds(this.db, guildId, new Date());
  }

  memberGroupIds(userId: number): Promise<number[]> {
    return memberServerHubIds(this.db, userId, new Date());
  }

  rankNames(): Promise<Map<number, string | null>> {
    return Promise.resolve(new Map<number, string | null>());
  }

  /** No `guild_members` rows, so member-id editor grants are never offered. */
  isLiveMember(): Promise<boolean> {
    return Promise.resolve(false);
  }

  async page(actor: GuildActor, guildId: number): Promise<GuildPage> {
    const hub = await findHubGuild(this.db, guildId);
    if (!hub) throw new NotFoundException('Guild not found');
    const { guild } = hub;
    const now = new Date();
    const online = this.membership.onlineSteamIds(guild.pelicanServerId);
    const [members, role, server, claimed] = await Promise.all([
      loadServerMembers(this.db, guildId, now),
      this.resolveLadder(actor, guildId),
      loadServerBlock(this.db, guild.pelicanServerId, now),
      claimedOnlineSteamIds(this.db, guild.pelicanServerId, online),
    ]);
    return buildServerHubPage({
      guild: hubSummaryFor(hub, isStaff(actor)),
      role,
      viewerId: actor.id,
      members,
      onlineSteamIds: online,
      // Only Valheim has characters to claim; elsewhere the count is unknown.
      claimedSteamIds: server?.gameSlug === VALHEIM_GAME_SLUG ? claimed : null,
      server,
    });
  }

  /**
   * Events tagged to the hub (`events.guild_id`), same lists as a community
   * hub. A server hub still has no roster, schedule or attendance widgets.
   * Before this it always answered empty, so a tagged Valheim session never
   * showed on its hub (prod, event 283, 2026-10-22).
   */
  async raids(actor: GuildActor, guildId: number): Promise<GuildRaidsDto> {
    if (!(await findGuild(this.db, guildId))) {
      throw new NotFoundException('Guild not found');
    }
    return loadCommunityHubEvents(this.db, guildId, actor.id);
  }

  // No `mineRanks`: server hubs have no ranks, and answering null for every
  // id would clobber another kind's real rank in `guilds/mine` (Codex r1).
}
