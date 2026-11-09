import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterMemberResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../../guilds/guild-access.service';
import { findHubGuild } from '../../../../guilds/guild-core.queries';
import { isForeverGame } from '../../wow-forever-identity.helpers';
import { notMemberError } from '../guild-page.service';
import { selectAudience } from './roster-member.helpers';
import { toRosterMemberCharacter } from './roster-member.mapper';
import { isGuildClaimable, loadRosterMember } from './roster-member.queries';

type Db = PostgresJsDatabase<typeof schema>;

const MEMBER_NOT_FOUND = 'Roster member not found';

/**
 * ROK-2149 — `GET /plugins/wow/guilds/:id/members/:memberId`. Two
 * audiences (operator direction 2026-11-09 ~15:30Z): hub members + staff
 * (`GuildAccessService.canView`) get the full payload, or the claimed
 * character's id to redirect to; any other signed-in user gets the
 * payload WITHOUT rank / last seen, only for an unclaimed member of a
 * claimable WoW: Forever guild. Everyone else: the hub page's 403.
 * Hidden hubs are refused by `HubVisibleGuard` (404) before this runs.
 */
@Injectable()
export class RosterMemberService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
  ) {}

  async detail(
    actor: GuildActor,
    guildId: number,
    memberId: number,
  ): Promise<WowRosterMemberResponseDto> {
    const hub = await findHubGuild(this.db, guildId);
    if (hub === null) throw new NotFoundException('Guild not found');
    const canView = await this.access.canView(actor, guildId);
    const claimable =
      isForeverGame({ slug: hub.gameSlug ?? '' }) &&
      (await isGuildClaimable(this.db, hub.guild.gameId, guildId));
    // A non-member of a non-claimable guild learns nothing about member ids.
    if (!canView && !claimable) throw notMemberError();
    const row = await loadRosterMember(this.db, guildId, memberId);
    if (row === null) throw new NotFoundException(MEMBER_NOT_FOUND);
    const unclaimed = row.unclaimed;
    const audience = selectAudience({ canView, unclaimed, claimable });
    if (audience === 'forbidden') throw notMemberError();
    if (audience === 'member' && row.claimedCharacterId !== null) {
      return {
        claimedCharacterId: row.claimedCharacterId,
        rosterMemberId: row.memberId,
        hubId: row.guildId,
      };
    }
    return toRosterMemberCharacter(row, {
      includeRoster: audience === 'member',
      canClaim: claimable && unclaimed,
    });
  }
}
