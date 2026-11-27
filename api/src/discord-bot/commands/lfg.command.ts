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
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { listGroupMembers } from '../../lfg/lfg-query.helpers';
import { LfgService } from '../../lfg/lfg.service';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { SettingsService } from '../../settings/settings.service';
import { autocompleteGameIds } from './bind.autocomplete';
import {
  LFG_BLOCKED_REPLY,
  LFG_LIST_CHOICE,
  LFG_LIST_SENTINEL,
  LFG_UNLINKED_REPLY,
  LFG_URGENCY_CHOICES,
  buildJoinReply,
  buildListReply,
  buildUnknownGameReply,
  forumPostLink,
  type LfgPostLinks,
  type LfgReplyContext,
  type LfgJoinReplyInput,
} from './lfg.command.helpers';
import {
  horizonReplyLine,
  resolveLfgCommandUrgency,
} from './lfg-command-urgency.helpers';
import {
  LFG_DUNGEON_OPTION,
  buildUnknownDungeonReply,
  dungeonOption,
  type LfgDungeonGroup,
} from './lfg-dungeon.helpers';
import {
  catalogueChoices,
  findVisibleLfgGame,
  joinRequest,
  resolveGameDungeon,
  type LfgGamePick,
  type LfgJoinOptions,
} from './lfg-command-join.helpers';
import { listLfmThreadsForGames } from '../lfg-board/lfg-board.db-helpers';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

/** Discord accepts at most 25 autocomplete choices, and one is the sentinel. */
const MAX_GAME_CHOICES = 24;

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
  settingsService: Pick<
    SettingsService,
    'getDiscordBotCommunityName' | 'getClientUrl' | 'getDiscordBotTimezone'
  >,
): Promise<LfgReplyContext> {
  const [communityName, clientUrl, timezone] = await Promise.all([
    settingsService.getDiscordBotCommunityName(),
    settingsService.getClientUrl(),
    settingsService.getDiscordBotTimezone(),
  ]);
  return { communityName, clientUrl, timezone };
}

/**
 * ROK-1471 D8 — forum post links for a whole list, read in ONE query rather
 * than per row. Shared by `/lfg`, `/lfg-leave` and the composer's `My LFGs`.
 */
export async function loadLfgPostLinks(
  db: PostgresJsDatabase<typeof schema>,
  gameIds: number[],
): Promise<LfgPostLinks> {
  const threads = await listLfmThreadsForGames(db, gameIds);
  return new Map(
    threads.map((t) => [t.gameId, forumPostLink(t.guildId, t.threadId)]),
  );
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
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return (
      new SlashCommandBuilder()
        .setName('lfg')
        .setDescription(
          'Raise a hand for a game, or list the groups you are already in',
        )
        .setDMPermission(false)
        .addStringOption((opt) =>
          opt
            .setName('game')
            .setDescription(
              'Game to look for — leave empty to list your groups',
            )
            .setAutocomplete(true)
            .setMaxLength(100),
        )
        // ROK-1479 — one option, three choices. The TTL rides inside the value
        // so `{ urgency: 'week', ttlMinutes: 60 }` (which the contract rejects,
        // A2) is unrepresentable from the picker.
        .addStringOption((opt) =>
          opt
            .setName('urgency')
            // ROK-1656 — an open group's pace first, else tonight.
            .setDescription(
              'How soon you want to play — matches an open group, else tonight',
            )
            .addChoices(...LFG_URGENCY_CHOICES),
        )
        // ROK-2352 §4.2 — lists raids too, hence "Dungeon or raid". No
        // `role` option (Q8): the hand copies the last web pick.
        .addStringOption(dungeonOption('leave empty for Any dungeon'))
        .toJSON()
    );
  }

  /** `My groups` is always first, so `/lfg list` is reachable by typing. */
  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name === LFG_DUNGEON_OPTION) {
      const game = interaction.options.getString('game');
      const choices = await catalogueChoices(
        this.db,
        this.pluginRegistry,
        game,
        focused.value,
      );
      await interaction.respond(choices);
      return;
    }
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
    const urgency = interaction.options.getString('urgency');
    const dungeon = interaction.options.getString(LFG_DUNGEON_OPTION);
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
    const options = { game: typed, urgency, dungeon };
    await this.replyWithJoin(interaction, caller.id, options, ctx);
  }

  /** Resolve the pick, then take the one write path or explain the miss. */
  private async replyWithJoin(
    interaction: ChatInputCommandInteraction,
    userId: number,
    options: LfgJoinOptions,
    ctx: LfgReplyContext,
  ): Promise<void> {
    const game = await findVisibleLfgGame(this.db, options.game);
    if (game === null) {
      await interaction.editReply({
        embeds: [buildUnknownGameReply(options.game, ctx)],
      });
      return;
    }
    const group = await resolveGameDungeon(
      this.pluginRegistry,
      game,
      options.dungeon,
    );
    if (group === null) {
      await interaction.editReply(
        buildUnknownDungeonReply(options.dungeon ?? ''),
      );
      return;
    }
    await this.raiseHand(interaction, userId, { game, group }, options, ctx);
  }

  /** The one write path, then the join reply. */
  private async raiseHand(
    interaction: ChatInputCommandInteraction,
    userId: number,
    { game, group }: { game: LfgGamePick; group: LfgDungeonGroup },
    options: LfgJoinOptions,
    ctx: LfgReplyContext,
  ): Promise<void> {
    // ROK-1616 / ROK-1656 — see `joinRequest` (zone from `ctx`, never a
    // second settings lookup; no `urgency:` joins an open group's horizon).
    const opts = await resolveLfgCommandUrgency(
      this.db,
      game.id,
      options.urgency,
      group.scope,
    );
    const result = await this.lfgService.createIntent(
      userId,
      game.id,
      joinRequest(opts, ctx, group),
    );
    this.logger.debug(
      `Discord user ${interaction.user.id} raised a hand for game ${game.id}`,
    );
    const horizonLine =
      options.urgency === null ? horizonReplyLine(opts.urgency) : null;
    const input = await this.joinReplyInput(
      game.id,
      result,
      horizonLine,
      group,
    );
    await interaction.editReply({ embeds: [buildJoinReply(input, ctx)] });
  }

  /** Everything the join reply renders beyond the write result itself. */
  private async joinReplyInput(
    gameId: number,
    result: Awaited<ReturnType<LfgService['createIntent']>>,
    horizonLine: string | null,
    dungeon: LfgDungeonGroup,
  ): Promise<LfgJoinReplyInput> {
    const group = result.body.group;
    const memberNames =
      group.activeCount >= 2
        ? await this.rosterNames(gameId, dungeon.scope)
        : [];
    const postLink = await this.postLink(gameId);
    return {
      group,
      created: result.created,
      memberNames,
      postLink,
      horizonLine,
    };
  }

  /** The caller's own groups, with a withdraw button each. */
  private async replyWithList(
    interaction: ChatInputCommandInteraction,
    userId: number,
    ctx: LfgReplyContext,
  ): Promise<void> {
    const groups = await this.lfgService.listOwnGroups(userId);
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
  private postLinks(groups: LfgGroupSummaryDto[]): Promise<LfgPostLinks> {
    return loadLfgPostLinks(
      this.db,
      groups.map((g) => g.gameId),
    );
  }

  /**
   * Display names for the roster line, in the group's own order. Reads the
   * roster alone — the same members, same order as `getGroupDetail` — rather
   * than the whole group detail the reply does not otherwise use.
   */
  private async rosterNames(
    gameId: number,
    scope: string | null,
  ): Promise<string[]> {
    // ROK-2352 — the group the hand landed in; null (fold) = every hand.
    const members =
      scope === null
        ? await listGroupMembers(this.db, gameId)
        : await listGroupMembers(this.db, gameId, scope);
    return members.map((m) => m.displayName ?? m.username);
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
