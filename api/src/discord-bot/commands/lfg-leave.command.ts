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
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

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
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
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
      .toJSON();
  }

  /** Own hands only; an unlinked caller has none. */
  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
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
      await this.leaveOne(interaction, caller.id, groups, typed);
    }
  }

  /** One game: an own pick, a game they are not in, or no game at all. */
  private async leaveOne(
    interaction: ChatInputCommandInteraction,
    userId: number,
    groups: LfgGroupSummaryDto[],
    typed: string,
  ): Promise<void> {
    const own = matchOwnGroup(groups, typed);
    const game = own
      ? { id: own.gameId, name: own.gameName }
      : await this.findGame(typed);
    if (!game) {
      const ctx = await loadLfgReplyContext(this.settingsService);
      await interaction.editReply({
        embeds: [buildUnknownGameReply(typed, ctx)],
      });
      return;
    }
    const outcome = await leaveOneGroup(this.lfgService, userId, game.id);
    await interaction.editReply(
      outcome.left
        ? buildLeftReply(game.name, outcome.stillLooking)
        : buildNotInGroupReply(game.name),
    );
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
  private async findGame(
    typed: string,
  ): Promise<{ id: number; name: string } | null> {
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

  private async selectGame(
    where: SQL,
  ): Promise<{ id: number; name: string } | null> {
    const [match] = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(where)
      .limit(1);
    return match ?? null;
  }
}
