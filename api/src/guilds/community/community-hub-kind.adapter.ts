import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GuildKind,
  GuildPage,
  GuildRaidsDto,
  LadderRole,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { HubKindAdapter } from '../../plugins/plugin-host/extension-points';
import { isStaff, type GuildActor } from '../guild-access.service';
import { findGuild, hubSummaryFor } from '../guild-core.queries';
import { loadCommunityHubEvents } from './community-events.queries';
import { buildCommunityHubPage } from './community-hub-page.helpers';
import {
  communityMemberUserIds,
  liveCommunityRole,
  loadCommunityMembers,
  loadDiscordFields,
  memberCommunityHubIds,
} from './community-hub.reads';
import { isInDiscordGuild } from './discord-guild-member.helpers';

/** ROK-1870: core registers the kind under this slug (no owner plugin, A4). */
export const COMMUNITY_HUB_PLUGIN_SLUG = 'core';

/** The no-roster raids shape (schedule/composition/attendance stay empty). */
export const EMPTY_COMMUNITY_HUB_RAIDS: GuildRaidsDto = {
  upcoming: [],
  recent: [],
  schedule: [],
  composition: null,
  attendance: { windowWeeks: 8, rows: [] },
  nextRaid: null,
};

/**
 * ROK-1870 D2/D4: the core-owned `game_community` hub kind. Ladder: staff ⇒
 * leader, a live row in an ACTIVE hub ⇒ its role, else visitor. Proposed and
 * archived hubs are refused upstream for non-staff (A7, `assertNotHidden`).
 */
@Injectable()
export class CommunityHubKindAdapter implements HubKindAdapter {
  readonly kind: GuildKind = 'game_community';
  readonly pluginSlug: string = COMMUNITY_HUB_PLUGIN_SLUG;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async isMember(userId: number, guildId: number): Promise<boolean> {
    return (await liveCommunityRole(this.db, guildId, userId)) !== null;
  }

  async resolveLadder(actor: GuildActor, guildId: number): Promise<LadderRole> {
    if (isStaff(actor)) return 'leader';
    return (await liveCommunityRole(this.db, guildId, actor.id)) ?? 'visitor';
  }

  memberUserIds(guildId: number): Promise<number[]> {
    return communityMemberUserIds(this.db, guildId);
  }

  memberGroupIds(userId: number): Promise<number[]> {
    return memberCommunityHubIds(this.db, userId);
  }

  /** D6: no ranks, so no rank grants. */
  rankNames(): Promise<Map<number, string | null>> {
    return Promise.resolve(new Map<number, string | null>());
  }

  /** D6: no `guild_members` rows, so member-id editor grants never apply. */
  isLiveMember(): Promise<boolean> {
    return Promise.resolve(false);
  }

  async page(actor: GuildActor, guildId: number): Promise<GuildPage> {
    const guild = await findGuild(this.db, guildId);
    if (!guild) throw new NotFoundException('Guild not found');
    const staff = isStaff(actor);
    const [members, role, discord] = await Promise.all([
      loadCommunityMembers(this.db, guildId),
      this.resolveLadder(actor, guildId),
      loadDiscordFields(this.db, actor.id),
    ]);
    return buildCommunityHubPage({
      guild: hubSummaryFor(guild, staff),
      status: guild.status,
      blurb: guild.blurb,
      role,
      viewerId: actor.id,
      viewerMayJoin: staff || (discord !== null && isInDiscordGuild(discord)),
      members,
    });
  }

  /** ROK-1870 L3: events tagged to the hub (`events.guild_id`). */
  async raids(actor: GuildActor, guildId: number): Promise<GuildRaidsDto> {
    if (!(await findGuild(this.db, guildId))) {
      throw new NotFoundException('Guild not found');
    }
    return loadCommunityHubEvents(this.db, guildId, actor.id);
  }
}
