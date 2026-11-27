/**
 * ROK-1660 — `/lfg-leave`, the one-step way out of an LFG.
 *
 * `game` autocompletes ONLY the caller's own hands, behind an `All my LFGs`
 * choice that leaves every one of them immediately (operator ruling: no
 * confirm — the pick is deliberate). Bare `/lfg-leave` shows the `/lfg` list.
 *
 * Every write is `LfgService.withdraw` — the HTTP route's method — so the
 * group-changed event (and the board post re-render) fire identically. There
 * is no second write path.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { eq, ilike, type SQL } from 'drizzle-orm';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { escapeLikePattern } from '../../common/search.util';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { LfgService } from '../../lfg/lfg.service';
import { resolveLfgGrouping } from '../../lfg/lfg-grouping.helpers';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { SettingsService } from '../../settings/settings.service';
import {
  loadLfgPostLinks,
  loadLfgReplyContext,
  resolveLfgCaller,
} from './lfg.command';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
  buildListReply,
  buildUnknownGameReply,
} from './lfg.command.helpers';
import {
  LFG_LEAVE_ALL_SENTINEL,
  LFG_LEAVE_NONE_SENTINEL,
  buildLeaveChoices,
  buildLeftAllReply,
  buildLeftSomeReply,
  matchOwnGroup,
  ownGroups,
} from './lfg-leave.helpers';
import {
  buildLeftReply,
  buildNotInGroupReply,
  leaveOneGroup,
  withdrawIfPresent,
} from '../listeners/lfg-leave.helpers';
import {
  LFG_DUNGEON_OPTION,
  buildDungeonChoices,
  buildUnknownDungeonReply,
  dungeonOption,
  listOwnHandKeys,
  resolveDungeonGroup,
  type LfgDungeonChoice,
  type LfgDungeonGroup,
} from './lfg-dungeon.helpers';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

/** The game a leave is about. */
interface LfgLeaveGame {
  id: number;
  name: string;
  slug: string;
}

/** `games.id` is an int4; anything larger is not a pick, it is noise. */
const PG_INT4_MAX = 2147483647;

@Injectable()
export class LfgLeaveCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'lfg-leave';
  private readonly logger = new Logger(LfgLeaveCommand.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly lfgService: LfgService,
    private readonly settingsService: SettingsService,
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return (
      new SlashCommandBuilder()
        .setName('lfg-leave')
        .setDescription("Leave an LFG you're in")
        .setDMPermission(false)
        .addStringOption((opt) =>
          opt
            .setName('game')
            .setDescription('Which LFG to leave — leave empty to see your list')
            .setAutocomplete(true)
            .setMaxLength(100),
        )
        // ROK-2352 — omitted = every hand in the game (`withdraw` with no group).
        .addStringOption(dungeonOption('leave empty to leave them all'))
        .toJSON()
    );
  }

  /** Own hands only; an unlinked caller has none. */
  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name === LFG_DUNGEON_OPTION) {
      await interaction.respond(
        await this.ownDungeonChoices(interaction, focused.value),
      );
      return;
    }
    if (focused.name !== 'game') return;
    const caller = await resolveLfgCaller(this.db, interaction.user.id);
    const groups = caller ? await this.lfgService.listOwnGroups(caller.id) : [];
    await interaction.respond(buildLeaveChoices(groups, focused.value));
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const typed = interaction.options.getString('game');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const caller = await resolveLfgCaller(this.db, interaction.user.id);
    if (!caller) {
      await interaction.editReply(LFG_UNLINKED_REPLY);
      return;
    }
    if (caller.deactivatedAt || caller.bannedAt) {
      await interaction.editReply(LFG_BLOCKED_REPLY);
      return;
    }
    if (typed === LFG_LEAVE_ALL_SENTINEL) {
      await this.leaveAll(interaction, caller.id);
      return;
    }
    const groups = await this.lfgService.listOwnGroups(caller.id);
    if (!typed || typed === LFG_LEAVE_NONE_SENTINEL) {
      await this.replyWithList(interaction, groups);
    } else {
      const dungeon = interaction.options.getString(LFG_DUNGEON_OPTION);
      await this.leaveOne(interaction, caller.id, groups, typed, dungeon);
    }
  }

  /** One game: an own pick, a game they are not in, or no game at all. */
  private async leaveOne(
    interaction: ChatInputCommandInteraction,
    userId: number,
    groups: LfgGroupSummaryDto[],
    typed: string,
    dungeon: string | null = null,
  ): Promise<void> {
    const own = matchOwnGroup(groups, typed);
    const game = own
      ? { id: own.gameId, name: own.gameName, slug: own.gameSlug }
      : await this.findGame(typed);
    if (!game) {
      const ctx = await loadLfgReplyContext(this.settingsService);
      await interaction.editReply({
        embeds: [buildUnknownGameReply(typed, ctx)],
      });
      return;
    }
    const group = await this.leaveGroup(game, dungeon);
    if (group === null) {
      await interaction.editReply(buildUnknownDungeonReply(dungeon ?? ''));
      return;
    }
    await this.leaveAndReply(interaction, userId, game, group);
  }

  /** The write (every hand when `group` is undefined), worded. */
  private async leaveAndReply(
    interaction: ChatInputCommandInteraction,
    userId: number,
    game: LfgLeaveGame,
    group: LfgDungeonGroup | undefined,
  ): Promise<void> {
    const outcome = await leaveOneGroup(
      this.lfgService,
      userId,
      game.id,
      group?.groupKey,
    );
    const name = group?.label ? `${game.name} — ${group.label}` : game.name;
    await interaction.editReply(
      outcome.left
        ? buildLeftReply(name, outcome.stillLooking)
        : buildNotInGroupReply(name),
    );
  }

  /**
   * ROK-2352 — the `dungeon` option: undefined = every hand (omitted, or the
   * game folds and the option is ignored); null = an unknown dungeon.
   */
  private async leaveGroup(
    game: LfgLeaveGame,
    dungeon: string | null,
  ): Promise<LfgDungeonGroup | undefined | null> {
    const adapter = resolveLfgGrouping(this.pluginRegistry, game.slug);
    if (dungeon === null || adapter === null) return undefined;
    const ctx = { gameId: game.id, gameSlug: game.slug };
    return resolveDungeonGroup(adapter, ctx, dungeon);
  }

  /** ROK-2352 — autocomplete over the caller's own hands in the game. */
  private async ownDungeonChoices(
    interaction: AutocompleteInteraction,
    typed: string,
  ): Promise<LfgDungeonChoice[]> {
    const caller = await resolveLfgCaller(this.db, interaction.user.id);
    const gameTyped = interaction.options.getString('game');
    if (!caller || !gameTyped) return [];
    const groups = await this.lfgService.listOwnGroups(caller.id);
    const own = matchOwnGroup(groups, gameTyped);
    const adapter = own
      ? resolveLfgGrouping(this.pluginRegistry, own.gameSlug)
      : null;
    if (!own || adapter === null) return [];
    const ctx = { gameId: own.gameId, gameSlug: own.gameSlug };
    const [keys, catalogue] = await Promise.all([
      listOwnHandKeys(this.db, caller.id, own.gameId),
      adapter.listGroups(ctx),
    ]);
    const held = catalogue.filter((g) => keys.includes(g.key));
    return buildDungeonChoices(held, typed, keys.includes(''));
  }

  /**
   * `All my LFGs` — withdraw every own hand, then say which ones went. Reads
   * the UNFILTERED own list: a hand on a hidden or banned game must go too.
   */
  private async leaveAll(
    interaction: ChatInputCommandInteraction,
    userId: number,
  ): Promise<void> {
    const groups = await this.lfgService.listOwnGroupsForWithdrawal(userId);
    const { left, failed } = await this.withdrawEach(userId, ownGroups(groups));
    const [only] = left;
    if (failed.length > 0) {
      await interaction.editReply(
        buildLeftSomeReply(
          left.map((g) => g.gameName),
          failed.map((g) => g.gameName),
        ),
      );
    } else if (left.length === 0 || !only) {
      await this.replyWithList(interaction, []);
    } else if (left.length === 1) {
      const reply = await this.leftReply(only.gameId, only.gameName);
      await interaction.editReply(reply);
    } else {
      await interaction.editReply(
        buildLeftAllReply(left.map((g) => g.gameName)),
      );
    }
  }

  /**
   * Withdraw each group in turn. One failure does not stop the rest, and the
   * writes that DID land are reported rather than lost behind a generic error.
   */
  private async withdrawEach(
    userId: number,
    groups: LfgGroupSummaryDto[],
  ): Promise<{ left: LfgGroupSummaryDto[]; failed: LfgGroupSummaryDto[] }> {
    const left: LfgGroupSummaryDto[] = [];
    const failed: LfgGroupSummaryDto[] = [];
    for (const group of groups) {
      try {
        if (await withdrawIfPresent(this.lfgService, userId, group.gameId)) {
          left.push(group);
        }
      } catch (error) {
        this.logger.error(`Failed to leave LFG game ${group.gameId}:`, error);
        failed.push(group);
      }
    }
    return { left, failed };
  }

  /** `You're out — …` with the count re-read after the write. */
  private async leftReply(gameId: number, gameName: string): Promise<string> {
    const stillLooking = await this.lfgService.countStillLooking(gameId);
    return buildLeftReply(gameName, stillLooking);
  }

  /** The `/lfg` list — own groups with a leave button each, or empty copy. */
  private async replyWithList(
    interaction: ChatInputCommandInteraction,
    groups: LfgGroupSummaryDto[],
  ): Promise<void> {
    const own = ownGroups(groups);
    const [ctx, postLinks] = await Promise.all([
      loadLfgReplyContext(this.settingsService),
      loadLfgPostLinks(
        this.db,
        own.map((g) => g.gameId),
      ),
    ]);
    await interaction.editReply(buildListReply(own, ctx, postLinks));
  }

  /**
   * A game the caller has no hand for: exact (case-insensitive, LIKE-escaped)
   * title first, then an all-digit value read as an id — as `/lfg` does.
   */
  private async findGame(typed: string): Promise<LfgLeaveGame | null> {
    const byName = await this.selectGame(
      ilike(schema.games.name, escapeLikePattern(typed)),
    );
    if (byName) return byName;
    const id = Number(typed);
    const isPick =
      /^\d+$/.test(typed) &&
      Number.isSafeInteger(id) &&
      id > 0 &&
      id <= PG_INT4_MAX;
    return isPick ? this.selectGame(eq(schema.games.id, id)) : null;
  }

  private async selectGame(where: SQL): Promise<LfgLeaveGame | null> {
    const [match] = await this.db
      .select({
        id: schema.games.id,
        name: schema.games.name,
        slug: schema.games.slug,
      })
      .from(schema.games)
      .where(where)
      .limit(1);
    return match ?? null;
  }
}
