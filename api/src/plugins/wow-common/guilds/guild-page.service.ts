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
import * as schema from '../../../drizzle/schema';
import {
  GuildAccessService,
  isStaff,
  type GuildActor,
} from './guild-access.service';
import {
  findLinkedMemberRows,
  toGuildSummary,
  type LinkedMemberRow,
} from './guild-membership.helpers';
import {
  findCharacterGuild,
  findGuild,
  findImportedBy,
  listGuildsOfGame,
  rankNamesByMemberId,
} from './guild-queries.helpers';
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
    const summaries = await this.access.myGuilds(actor.id);
    const rows = await findLinkedMemberRows(this.db, actor.id);
    const names = await rankNamesByMemberId(
      this.db,
      rows.map((r) => r.memberId),
    );
    const guilds: MyGuild[] = [];
    for (const g of summaries) {
      const best = bestRow(rows.filter((r) => r.guildId === g.id));
      guilds.push({
        ...g,
        rankIndex: best?.rankIndex ?? null,
        rankName: best ? (names.get(best.memberId) ?? null) : null,
        canEdit: await this.access.canEdit(actor, g.id),
      });
    }
    return { guilds };
  }

  /** Hero + roster; 403 unless the viewer may view, 404 when missing. */
  async page(actor: GuildActor, guildId: number): Promise<GuildPage> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException('Not a member of this guild');
    }
    const guild = await findGuild(this.db, guildId);
    if (!guild) throw new NotFoundException('Guild not found');
    const [rows, importedBy, canEdit, canManageEditors] = await Promise.all([
      loadRosterRows(this.db, guildId),
      findImportedBy(this.db, guildId),
      this.access.canEdit(actor, guildId),
      this.access.canManageEditors(actor, guildId),
    ]);
    return {
      guild: toGuildSummary(guild),
      importedBy,
      viewer: { canEdit, canManageEditors },
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
    if (!found) return { data: null };
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
    const all = await listGuildsOfGame(this.db, gameId);
    const guilds = all.map(
      (g) =>
        own.get(g.id) ?? {
          ...g,
          rankIndex: null,
          rankName: null,
          canEdit: true,
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
