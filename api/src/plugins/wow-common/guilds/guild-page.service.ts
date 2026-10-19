import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CharacterGuild,
  GuildPage,
  MyGuild,
  MyGuilds,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type { HubMineRank } from '../../plugin-host/extension-points';
import * as schema from '../../../drizzle/schema';
import {
  GuildAccessService,
  isStaff,
  viewerAccess,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import {
  findLinkedMemberRows,
  type LinkedMemberRow,
} from './guild-membership.helpers';
import { findGuild, hubSummaryFor } from '../../../guilds/guild-core.queries';
import {
  findCharacterGuild,
  findImportedBy,
  listGuildsOfGame,
  rankNamesByMemberId,
} from './guild-queries.helpers';
import { gmPostHeadlines } from '../../../guilds/guild-profile.queries';
import { hubGameIcons } from '../../../guilds/hub-game-icons.queries';
import {
  dropHiddenFor,
  isHiddenFrom,
} from '../../../guilds/hub-hidden.helpers';
import { computeRoleCounts } from './guild-role-counts.helpers';
import { groupRoster, loadRosterRows } from './guild-roster.helpers';

/**
 * ROK-1785 — read side of `/plugins/wow/guilds`. Every access answer comes
 * from `GuildAccessService` (D4); membership is never re-derived here.
 */
@Injectable()
export class GuildPageService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
  ) {}

  /** The viewer's guilds with their best rank and edit right. */
  async mine(actor: GuildActor): Promise<MyGuilds> {
    const summaries = await dropHiddenFor(
      this.db,
      actor,
      await this.access.myGuilds(actor.id),
    );
    const ids = summaries.map((g) => g.id);
    // Same shape as core `guilds/mine` (ROK-1831 D6 nav icon).
    const [ranks, headlines, icons] = await Promise.all([
      this.mineRanks(actor.id, ids),
      gmPostHeadlines(this.db, ids),
      hubGameIcons(
        this.db,
        summaries.map((g) => g.gameId),
      ),
    ]);
    const guilds: MyGuild[] = [];
    for (const g of summaries) {
      const rank = ranks.get(g.id);
      guilds.push({
        ...g,
        rankIndex: rank?.rankIndex ?? null,
        rankName: rank?.rankName ?? null,
        canEdit: await this.access.canEdit(actor, g.id),
        gmPostHeadline: headlines.get(g.id) ?? null,
        gameIconUrl: icons.get(g.gameId) ?? null,
      });
    }
    return { guilds };
  }

  /** ROK-1831: the user's best (lowest) rank per guild, by guild id. */
  async mineRanks(
    userId: number,
    guildIds: number[],
  ): Promise<Map<number, HubMineRank>> {
    const wanted = new Set(guildIds);
    const rows = (await findLinkedMemberRows(this.db, userId)).filter((r) =>
      wanted.has(r.guildId),
    );
    const names = await rankNamesByMemberId(
      this.db,
      rows.map((r) => r.memberId),
    );
    const out = new Map<number, HubMineRank>();
    for (const id of wanted) {
      const best = bestRow(rows.filter((r) => r.guildId === id));
      if (!best) continue;
      const rankName = names.get(best.memberId) ?? null;
      out.set(id, { rankIndex: best.rankIndex, rankName });
    }
    return out;
  }

  /** Hero + roster; 403 unless the viewer may view, 404 when missing. */
  async page(actor: GuildActor, guildId: number): Promise<GuildPage> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException('Not a member of this guild');
    }
    const guild = await findGuild(this.db, guildId);
    if (!guild) throw new NotFoundException('Guild not found');
    const [rows, importedBy, role] = await Promise.all([
      loadRosterRows(this.db, guildId),
      findImportedBy(this.db, guildId),
      this.access.resolveLadder(actor, guildId),
    ]);
    return {
      guild: hubSummaryFor(guild, isStaff(actor)),
      importedBy,
      viewer: viewerAccess(role),
      ranks: groupRoster(rows),
      roleCounts: computeRoleCounts(rows),
    };
  }

  /** The character's current guild + whether the viewer may open its page. */
  async byCharacter(
    actor: GuildActor,
    characterId: string,
  ): Promise<CharacterGuild> {
    const found = await findCharacterGuild(this.db, characterId);
    if (!found || (await isHiddenFrom(this.db, actor, found.guild.id))) {
      return { data: null };
    }
    const viewerCanOpen = await this.access.canView(actor, found.guild.id);
    return { data: { ...found, viewerCanOpen } };
  }

  /** Guilds of a game the viewer can open: staff all, members theirs. */
  async listForGame(actor: GuildActor, gameId: number): Promise<MyGuilds> {
    const mine = await this.mine(actor);
    if (!isStaff(actor)) {
      return { guilds: mine.guilds.filter((g) => g.gameId === gameId) };
    }
    const own = new Map(mine.guilds.map((g) => [g.id, g]));
    const all = await listGuildsOfGame(this.db, gameId); // staff: hidden included
    const headlines = await gmPostHeadlines(
      this.db,
      all.map((g) => g.id),
    );
    const guilds = all.map(
      (g) =>
        own.get(g.id) ?? {
          ...g,
          rankIndex: null,
          rankName: null,
          canEdit: true,
          gmPostHeadline: headlines.get(g.id) ?? null,
        },
    );
    return { guilds };
  }
}

/** The viewer's highest rank (lowest index) among their rows in one guild. */
function bestRow(rows: LinkedMemberRow[]): LinkedMemberRow | undefined {
  return [...rows].sort(
    (a, b) =>
      (a.rankIndex ?? Number.MAX_SAFE_INTEGER) -
      (b.rankIndex ?? Number.MAX_SAFE_INTEGER),
  )[0];
}
