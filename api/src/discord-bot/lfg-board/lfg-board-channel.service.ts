/**
 * ROK-1471 D3 / AC2 — resolving (and, when needed, creating) the LFG forum.
 *
 * The operator never has to create a channel. Resolution order is
 * binding → stored id → create, and every step is allowed to fail:
 *
 *  1. **Never throw.** The only caller runs under `LFM_REACHED`, whose emitter
 *     is `POST /lfg`. A missing `Manage Channels` grant must degrade to the
 *     1454 text board (E1), not become a 500 on a successful signup.
 *  2. **Never trust the stored id.** The channel behind it can be deleted (E3)
 *     or replaced; anything that is not a `GuildForum` is discarded and a new
 *     one created.
 *  3. **Create at most once.** A burst of `LFM_REACHED` for different games
 *     shares one in-flight creation promise, and that flight re-reads the
 *     setting before it calls Discord so a restart mid-burst cannot double up
 *     either (E6).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChannelType } from 'discord.js';
import type {
  ForumChannel,
  Guild,
  GuildChannelCreateOptions,
  GuildForumTagData,
} from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import {
  getLfgBoardChannelId,
  setLfgBoardChannelId,
} from '../../settings/settings-lfg-board.helpers';
import { timedDiscordCall } from '../services/scheduled-event.helpers';
import { findLfgBoardBindingChannelId } from './lfg-board-channel.db-helpers';
import {
  LFG_BOARD_TOPIC,
  boardOverwriteEdit,
  boardOverwrites,
  overwritesUpToDate,
  topicHasSentinel,
  topicWithSentinel,
} from './lfg-board-permissions.helpers';
import {
  DISCORD_FORUM_TAG_CAP,
  LFG_BOARD_CHANNEL_NAME,
  LFG_BOARD_TAGS,
  type LfgBoardTag,
} from './lfg-board.constants';

/** Best-effort message for a caught `unknown`, never a bare cast. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Fetch `id` and return it only if it is still a forum channel. */
async function fetchForum(
  guild: Guild,
  id: string,
): Promise<ForumChannel | null> {
  const channel = await guild.channels.fetch(id).catch(() => null);
  return channel?.type === ChannelType.GuildForum ? channel : null;
}

@Injectable()
export class LfgBoardChannelService {
  private readonly logger = new Logger(LfgBoardChannelService.name);

  /** The single in-flight creation, shared by every concurrent resolve. */
  private creating: Promise<ForumChannel | null> | null = null;

  /** Forums whose post-lock edit was refused; skipped until a resolve finds it in place. */
  private readonly lockRefused = new Set<string>();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * The forum the LFG board posts into, creating one if the guild has none.
   *
   * @param guild - The connected guild.
   * @returns The forum, or null when it could not be resolved or created —
   *   in which case the caller falls back to the 1454 text board.
   */
  async resolveForum(guild: Guild): Promise<ForumChannel | null> {
    const boundId = await findLfgBoardBindingChannelId(this.db, guild.id);
    const override = boundId ? await this.resolveBound(guild, boundId) : null;
    if (override) {
      return this.reconcileForum(guild, await this.ensureTags(override));
    }

    const stored = await this.resolveStored(guild);
    if (stored) return this.reconcileForum(guild, stored);

    const marked = await this.resolveMarked(guild, boundId);
    if (marked) return marked;

    return this.createForum(guild);
  }

  /**
   * Re-assert the board's two channel invariants on a forum it did not create:
   * the bot-only overwrite pair (R3, on bound forums too — A7) and the topic
   * sentinel a restore rediscovers it by (ROK-1492 AC1 / A4).
   *
   * Both steps are advisory (D10): a refusal warns and the forum is STILL
   * returned, because an open board beats no board (E1). When both are already
   * satisfied this costs zero Discord calls — the decision is read from the
   * cached overwrites and the cached topic.
   *
   * @param guild - The connected guild, for `@everyone` and the bot's own id.
   * @param forum - The resolved board forum.
   * @returns The same forum, always.
   */
  async reconcileForum(
    guild: Guild,
    forum: ForumChannel,
  ): Promise<ForumChannel> {
    await this.assertOverwrites(guild, forum);
    await this.assertTopic(forum);
    return forum;
  }

  /**
   * The forum tag id matching a board state, for `thread.setAppliedTags`.
   *
   * @param forum - The resolved board forum.
   * @param tag - One of the five 1454 author-line states.
   * @returns The tag id, or undefined when the forum has no such tag (E16:
   *   a full forum posts untagged rather than not at all).
   */
  tagIdFor(forum: ForumChannel, tag: LfgBoardTag): string | undefined {
    return forum.availableTags.find((t) => t.name === tag)?.id;
  }

  /**
   * Add any missing board tags to a forum the bot did not create.
   *
   * All-or-nothing: if the five tags will not fit under Discord's cap the
   * top-up is skipped and logged, and the forum is still returned. A post
   * without a tag is fine; a group without a post is not (E16).
   *
   * @param forum - The forum to reconcile.
   * @returns The same forum, always.
   */
  async ensureTags(forum: ForumChannel): Promise<ForumChannel> {
    const existing = forum.availableTags;
    const present = new Set(existing.map((t) => t.name));
    const missing = LFG_BOARD_TAGS.filter((name) => !present.has(name));
    if (missing.length === 0) return forum;

    if (existing.length + missing.length > DISCORD_FORUM_TAG_CAP) {
      this.logger.warn(
        `Forum ${forum.id} already holds ${String(existing.length)} of Discord's ` +
          `${String(DISCORD_FORUM_TAG_CAP)} tag slots — skipping the LFG board tag ` +
          'top-up. Posts will appear untagged until a slot is freed.',
      );
      return forum;
    }

    const next: GuildForumTagData[] = [
      ...existing,
      ...missing.map((name) => ({ name })),
    ];
    try {
      await timedDiscordCall('lfgBoard.tags', () =>
        forum.setAvailableTags(next),
      );
    } catch (err) {
      this.logger.warn(
        `Could not add the LFG board tags to forum ${forum.id}: ${describeError(err)}.`,
      );
    }
    return forum;
  }

  /** (a) The manual `lfg-board` binding, when it still points at a forum. */
  private async resolveBound(
    guild: Guild,
    bound: string,
  ): Promise<ForumChannel | null> {
    const forum = await fetchForum(guild, bound);
    if (!forum) {
      this.logger.warn(
        `The lfg-board binding points at ${bound}, which is not a forum ` +
          'channel (deleted, or bound to the wrong type). Ignoring the override.',
      );
    }
    return forum;
  }

  /** (b) The persisted id, discarded when it no longer names a forum. */
  private async resolveStored(guild: Guild): Promise<ForumChannel | null> {
    const stored = await getLfgBoardChannelId(this.settingsService);
    if (!stored) return null;

    const forum = await fetchForum(guild, stored);
    return forum ? this.ensureTags(forum) : null;
  }

  /**
   * (c) ROK-1492 AC1 — a forum this board already owns, found by the sentinel
   * in its topic. Runs after the stored id, so binding and stored id still win
   * (AC5), and again inside the creation flight so the E6 single flight cannot
   * create past a forum that appeared mid-burst.
   */
  private async resolveMarked(
    guild: Guild,
    preferId: string | null,
  ): Promise<ForumChannel | null> {
    const matches = await this.findMarkedForums(guild);
    if (matches.length === 0) return null;

    if (matches.length > 1) {
      this.logger.warn(
        `Found ${String(matches.length)} forums marked as the LFG board ` +
          `(${matches.map((f) => f.id).join(', ')}). Adopting the oldest — bind ` +
          'another with the lfg-board purpose to override this choice.',
      );
    }
    const chosen = matches.find((f) => f.id === preferId) ?? matches[0];
    await setLfgBoardChannelId(this.settingsService, chosen.id);
    return this.reconcileForum(guild, await this.ensureTags(chosen));
  }

  /**
   * Every forum in the guild carrying the board's ownership sentinel, oldest
   * first (snowflake order).
   *
   * Extracted from {@link resolveMarked} so the census and the adoption path
   * can never disagree about what "marked" means — a second copy of this
   * filter would be the thing that rots.
   *
   * Public for the startup census: a duplicate board is otherwise only noticed
   * the next time a group resolves, and only in a log nobody reads on purpose.
   * 16 stray forums accumulated in the dev guild before ROK-1492 taught the
   * board to rediscover its own; forums created BEFORE that carry no sentinel,
   * so they are invisible here by construction and must be removed by hand.
   *
   * @param guild - The connected guild.
   * @returns The marked forums, oldest first; empty when the fetch failed.
   */
  async findMarkedForums(guild: Guild): Promise<ForumChannel[]> {
    const all = await guild.channels.fetch().catch(() => null);
    return [...(all?.values() ?? [])]
      .filter(
        (c): c is ForumChannel =>
          c !== null &&
          c.type === ChannelType.GuildForum &&
          topicHasSentinel(c.topic),
      )
      .sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
  }

  /** R3 / AC2: at most one `edit` per half, and none when both are in place. */
  private async assertOverwrites(
    guild: Guild,
    forum: ForumChannel,
  ): Promise<void> {
    const everyoneId = guild.roles.everyone.id;
    const botUserId = guild.members.me?.id ?? null;
    // Never write the @everyone deny without a known bot id to pair it with:
    // a half-applied lock turns a working board into one the bot itself
    // cannot post to. Left untouched until the bot's member is cached.
    if (!botUserId) {
      this.logger.warn(
        `Forum ${forum.id}: the bot's own member is not cached, so the ` +
          'post lock was not asserted this time. It is re-checked on the ' +
          'next enable / resolve.',
      );
      return;
    }
    const state = overwritesUpToDate(forum, everyoneId, botUserId);
    if (state.everyone && state.bot) {
      this.lockRefused.delete(forum.id);
      return;
    }
    // A refused edit is remembered so the LFM_REACHED hot path does not
    // re-issue failing REST calls on every post (the cache never updates
    // after a refusal). Cleared when a later resolve finds the lock in place.
    if (this.lockRefused.has(forum.id)) return;

    try {
      if (!state.everyone) {
        await this.editOverwrite(forum, everyoneId, 'everyone');
      }
      if (!state.bot) {
        await this.editOverwrite(forum, botUserId, 'bot');
      }
    } catch (err) {
      this.lockRefused.add(forum.id);
      this.logger.warn(
        `Could not lock forum ${forum.id} to bot-only posts: ${describeError(err)}. ` +
          'Grant the bot Manage Roles and keep its role above the members it ' +
          'must restrict. The board still runs; members can still open posts.',
      );
    }
  }

  /** One `.edit` — never `.set`, which would drop the operator's overwrites. */
  private editOverwrite(
    forum: ForumChannel,
    id: string,
    half: 'everyone' | 'bot',
  ): Promise<unknown> {
    return timedDiscordCall('lfgBoard.perms', () =>
      forum.permissionOverwrites.edit(id, boardOverwriteEdit(half), {
        reason: 'Raid Ledger LFG board',
      }),
    );
  }

  /** A4: the topic must CONTAIN the sentinel — operator text is preserved. */
  private async assertTopic(forum: ForumChannel): Promise<void> {
    if (topicHasSentinel(forum.topic)) return;
    try {
      await timedDiscordCall('lfgBoard.topic', () =>
        forum.setTopic(topicWithSentinel(forum.topic), 'Raid Ledger LFG board'),
      );
    } catch (err) {
      this.logger.warn(
        `Could not write the post guidelines on forum ${forum.id}: ` +
          `${describeError(err)}. Without them the forum carries no ownership ` +
          'mark, so a restore creates a second board forum instead of this one.',
      );
    }
  }

  /** The bot's own user id, warning when the member cache cannot say (P4). */
  private botUserIdForCreate(guild: Guild): string | null {
    const botUserId = guild.members.me?.id ?? null;
    if (!botUserId) {
      this.logger.warn(
        `Could not resolve the bot's own guild member, so the ` +
          `"${LFG_BOARD_CHANNEL_NAME}" forum is created without the bot's own ` +
          'allow overwrite. The board cannot post into it until the toggle is ' +
          'flipped again, which repairs the overwrite.',
      );
    }
    return botUserId;
  }

  /** (d) Create one, at most once across a concurrent burst. */
  private createForum(guild: Guild): Promise<ForumChannel | null> {
    this.creating ??= this.runCreate(guild).finally(() => {
      this.creating = null;
    });
    return this.creating;
  }

  /**
   * The one `channels.create` payload — locked (D1) and marked (D4) inline, so
   * a created forum needs no follow-up call to become the board (AC1).
   */
  private createOptions(
    guild: Guild,
  ): GuildChannelCreateOptions & { type: ChannelType.GuildForum } {
    return {
      name: LFG_BOARD_CHANNEL_NAME,
      type: ChannelType.GuildForum,
      availableTags: LFG_BOARD_TAGS.map((name) => ({ name })),
      permissionOverwrites: boardOverwrites(
        guild.roles.everyone.id,
        this.botUserIdForCreate(guild),
      ),
      topic: LFG_BOARD_TOPIC,
      reason: 'Raid Ledger LFG board',
    };
  }

  /** The body of the single flight: re-read, then create, then persist. */
  private async runCreate(guild: Guild): Promise<ForumChannel | null> {
    const raced = await this.resolveStored(guild);
    if (raced) return raced;

    const marked = await this.resolveMarked(guild, null);
    if (marked) return marked;

    try {
      const forum = await timedDiscordCall('lfgBoard.create', () =>
        guild.channels.create(this.createOptions(guild)),
      );
      await setLfgBoardChannelId(this.settingsService, forum.id);
      return forum;
    } catch (err) {
      this.logger.warn(
        `Could not create the "${LFG_BOARD_CHANNEL_NAME}" forum channel: ` +
          `${describeError(err)}. Grant the bot Manage Channels and Manage ` +
          'Roles (the post lock is a channel overwrite), or bind an ' +
          'existing forum with the lfg-board purpose. Falling back to the text board.',
      );
      return null;
    }
  }
}
