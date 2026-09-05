/**
 * ROK-1454 D10 — `/lfg`, the Discord-side twin of `POST /lfg`.
 *
 * ONE command, no subcommands: Discord forbids mixing subcommands with
 * top-level options, and ROK-1471 wants bare `/lfg` to list. So the AC's
 * literal `/lfg list` is a sentinel autocomplete CHOICE (`LFG_LIST_SENTINEL`)
 * rather than a subcommand, and every game choice is `String(games.id)`.
 *
 * Every write goes through `LfgService.createIntent` — the same method the HTTP
 * route calls — so `LFM_REACHED` / `GROUP_CHANGED` fire identically, the
 * advisory lock still serialises the group, and a repeat hand is idempotent
 * rather than an error. ROK-1471's `+1` button will call the same method.
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
import { autocompleteGameIds } from './bind.autocomplete';
import {
  LFG_BLOCKED_REPLY,
  LFG_LIST_CHOICE,
  LFG_LIST_SENTINEL,
  LFG_UNLINKED_REPLY,
  buildJoinReply,
  buildListReply,
  buildUnknownGameReply,
  forumPostLink,
  type LfgPostLinks,
  type LfgReplyContext,
} from './lfg.command.helpers';
import { listLfmThreadsForGames } from '../lfg-board/lfg-board.db-helpers';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

/** Discord accepts at most 25 autocomplete choices, and one is the sentinel. */
const MAX_GAME_CHOICES = 24;
/** `games.id` is an int4; anything larger is not a pick, it is noise. */
const PG_INT4_MAX = 2147483647;

/** The caller as the `/lfg` surface needs to see them. */
export interface LfgCaller {
  id: number;
  deactivatedAt: Date | null;
  bannedAt: Date | null;
}

/**
 * Discord id -> Raid Ledger user, or null when the account is unlinked.
 *
 * Exported because the withdraw button listener MUST resolve the caller the
 * same way: identity comes from the interaction, never from the custom id, or a
 * crafted id would withdraw someone else's intent.
 *
 * @param db - Drizzle handle.
 * @param discordId - `interaction.user.id`.
 * @returns The caller, or null when no user has that Discord id.
 */
export async function resolveLfgCaller(
  db: PostgresJsDatabase<typeof schema>,
  discordId: string,
): Promise<LfgCaller | null> {
  const [user] = await db
    .select({
      id: schema.users.id,
      deactivatedAt: schema.users.deactivatedAt,
      bannedAt: schema.users.bannedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  return user ?? null;
}

/**
 * Community name, web origin and timezone for a `/lfg` reply.
 *
 * @param settingsService - The settings facade.
 * @returns The render context; every field may be null.
 */
export async function loadLfgReplyContext(
  settingsService: SettingsService,
): Promise<LfgReplyContext> {
  const [communityName, clientUrl, timezone] = await Promise.all([
    settingsService.getDiscordBotCommunityName(),
    settingsService.getClientUrl(),
    settingsService.getDiscordBotTimezone(),
  ]);
  return { communityName, clientUrl, timezone };
}

@Injectable()
export class LfgCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'lfg';
  private readonly logger = new Logger(LfgCommand.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly lfgService: LfgService,
    private readonly settingsService: SettingsService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('lfg')
      .setDescription(
        'Raise a hand for a game, or list the groups you are already in',
      )
      .setDMPermission(false)
      .addStringOption((opt) =>
        opt
          .setName('game')
          .setDescription('Game to look for — leave empty to list your groups')
          .setAutocomplete(true)
          .setMaxLength(100),
      )
      .toJSON();
  }

  /** `My groups` is always first, so `/lfg list` is reachable by typing. */
  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'game') return;
    const games = await autocompleteGameIds(this.db, focused.value);
    await interaction.respond([
      LFG_LIST_CHOICE,
      ...games.slice(0, MAX_GAME_CHOICES),
    ]);
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const typed = interaction.options.getString('game');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const caller = await this.resolveCaller(interaction.user.id);
    if (!caller) {
      await interaction.editReply(LFG_UNLINKED_REPLY);
      return;
    }
    if (caller.deactivatedAt || caller.bannedAt) {
      await interaction.editReply(LFG_BLOCKED_REPLY);
      return;
    }
    const ctx = await this.replyContext();
    if (!typed || typed === LFG_LIST_SENTINEL) {
      await this.replyWithList(interaction, caller.id, ctx);
      return;
    }
    await this.replyWithJoin(interaction, caller.id, typed, ctx);
  }

  /** Resolve the pick, then take the one write path or explain the miss. */
  private async replyWithJoin(
    interaction: ChatInputCommandInteraction,
    userId: number,
    typed: string,
    ctx: LfgReplyContext,
  ): Promise<void> {
    const gameId = await this.resolveGameId(typed);
    if (gameId === null) {
      await interaction.editReply({
        embeds: [buildUnknownGameReply(typed, ctx)],
      });
      return;
    }
    const result = await this.lfgService.createIntent(userId, gameId);
    const group = result.body.group;
    const memberNames =
      group.activeCount >= 2 ? await this.rosterNames(userId, gameId) : [];
    const postLink = await this.postLink(gameId);
    this.logger.debug(
      `Discord user ${interaction.user.id} raised a hand for game ${gameId}`,
    );
    const input = { group, created: result.created, memberNames, postLink };
    await interaction.editReply({ embeds: [buildJoinReply(input, ctx)] });
  }

  /** The caller's own groups, with a withdraw button each. */
  private async replyWithList(
    interaction: ChatInputCommandInteraction,
    userId: number,
    ctx: LfgReplyContext,
  ): Promise<void> {
    const groups = await this.lfgService.listGroups(userId);
    const postLinks = await this.postLinks(groups);
    await interaction.editReply(buildListReply(groups, ctx, postLinks));
  }

  /**
   * ROK-1471 D8 — the forum post link for one game, or null when it has none
   * (the board is off, the group posted to the text surface, or it never
   * reached LFM). Omitted rather than faked: a dead link is worse than none.
   */
  private async postLink(gameId: number): Promise<string | null> {
    const [thread] = await listLfmThreadsForGames(this.db, [gameId]);
    return thread ? forumPostLink(thread.guildId, thread.threadId) : null;
  }

  /** D8 — post links for a whole list, read in ONE query rather than per row. */
  private async postLinks(groups: LfgGroupSummaryDto[]): Promise<LfgPostLinks> {
    const threads = await listLfmThreadsForGames(
      this.db,
      groups.map((g) => g.gameId),
    );
    return new Map(
      threads.map((t) => [t.gameId, forumPostLink(t.guildId, t.threadId)]),
    );
  }

  /** Display names for the roster line, in the group's own order. */
  private async rosterNames(userId: number, gameId: number): Promise<string[]> {
    const detail = await this.lfgService.getGroupDetail(userId, gameId);
    return detail.members.map((m) => m.displayName ?? m.username);
  }

  /**
   * Free-typed text first: one exact (case-insensitive) title match, with LIKE
   * metacharacters escaped so `%` cannot select an arbitrary game and then
   * WRITE an intent for it. Only when no title matches is an all-digit value
   * read as an autocomplete pick (`autocompleteGameIds` values are
   * `String(games.id)`): a game titled `1942` must win over the game whose id
   * happens to be 1942.
   */
  private async resolveGameId(typed: string): Promise<number | null> {
    const byName = await this.findGame(
      ilike(schema.games.name, escapeLikePattern(typed)),
    );
    if (byName !== null) return byName;
    const id = Number(typed);
    const isPick =
      /^\d+$/.test(typed) &&
      Number.isSafeInteger(id) &&
      id > 0 &&
      id <= PG_INT4_MAX;
    return isPick ? this.findGame(eq(schema.games.id, id)) : null;
  }

  /** The first game satisfying `where`, or null. */
  private async findGame(where: SQL): Promise<number | null> {
    const [match] = await this.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(where)
      .limit(1);
    return match?.id ?? null;
  }

  /** Delegates so the button listener resolves identity the identical way. */
  private resolveCaller(discordId: string): Promise<LfgCaller | null> {
    return resolveLfgCaller(this.db, discordId);
  }

  /** Community name, web origin and timezone, read once per interaction. */
  private replyContext(): Promise<LfgReplyContext> {
    return loadLfgReplyContext(this.settingsService);
  }
}
