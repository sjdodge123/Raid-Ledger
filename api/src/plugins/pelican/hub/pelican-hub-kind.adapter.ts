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
import { findGuild, hubSummaryFor } from '../../../guilds/guild-core.queries';
import type { HubKindAdapter } from '../../plugin-host/extension-points';
import { PELICAN_PLUGIN_ID } from '../pelican.constants';
import {
  isServerHubMemberRow,
  memberServerHubIds,
  serverHubMemberUserIds,
} from './server-hub-membership.queries';
import { ServerHubMembershipService } from './server-hub-membership.service';
import { buildServerHubPage } from './server-hub-page.helpers';
import { loadServerBlock, loadServerMembers } from './server-hub-page.queries';

/** A server hub has no raid roster: every Raids widget is empty (contract shape). */
export const EMPTY_SERVER_HUB_RAIDS: GuildRaidsDto = {
  upcoming: [],
  recent: [],
  schedule: [],
  composition: null,
  attendance: { windowWeeks: 8, rows: [] },
  nextRaid: null,
};

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
    const guild = await findGuild(this.db, guildId);
    if (!guild) throw new NotFoundException('Guild not found');
    const now = new Date();
    const [members, role, server] = await Promise.all([
      loadServerMembers(this.db, guildId, now),
      this.resolveLadder(actor, guildId),
      loadServerBlock(this.db, guild.pelicanServerId, now),
    ]);
    return buildServerHubPage({
      guild: hubSummaryFor(guild, isStaff(actor)),
      role,
      viewerId: actor.id,
      members,
      onlineSteamIds: this.membership.onlineSteamIds(guild.pelicanServerId),
      server,
    });
  }

  async raids(_actor: GuildActor, guildId: number): Promise<GuildRaidsDto> {
    if (!(await findGuild(this.db, guildId))) {
      throw new NotFoundException('Guild not found');
    }
    return EMPTY_SERVER_HUB_RAIDS;
  }

  // No `mineRanks`: server hubs have no ranks, and answering null for every
  // id would clobber another kind's real rank in `guilds/mine` (Codex r1).
}
