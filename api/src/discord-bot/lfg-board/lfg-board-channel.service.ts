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
import type { ForumChannel, Guild, GuildForumTagData } from 'discord.js';
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
    const override = await this.resolveOverride(guild);
    if (override) return this.ensureTags(override);

    const stored = await this.resolveStored(guild);
    if (stored) return stored;

    return this.createForum(guild);
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
  private async resolveOverride(guild: Guild): Promise<ForumChannel | null> {
    const bound = await findLfgBoardBindingChannelId(this.db, guild.id);
    if (!bound) return null;

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

  /** (c) Create one, at most once across a concurrent burst. */
  private createForum(guild: Guild): Promise<ForumChannel | null> {
    this.creating ??= this.runCreate(guild).finally(() => {
      this.creating = null;
    });
    return this.creating;
  }

  /** The body of the single flight: re-read, then create, then persist. */
  private async runCreate(guild: Guild): Promise<ForumChannel | null> {
    const raced = await this.resolveStored(guild);
    if (raced) return raced;

    try {
      const forum = await timedDiscordCall('lfgBoard.create', () =>
        guild.channels.create({
          name: LFG_BOARD_CHANNEL_NAME,
          type: ChannelType.GuildForum,
          availableTags: LFG_BOARD_TAGS.map((name) => ({ name })),
          reason: 'Raid Ledger LFG board',
        }),
      );
      await setLfgBoardChannelId(this.settingsService, forum.id);
      return forum;
    } catch (err) {
      this.logger.warn(
        `Could not create the "${LFG_BOARD_CHANNEL_NAME}" forum channel: ` +
          `${describeError(err)}. Grant the bot Manage Channels, or bind an ` +
          'existing forum with the lfg-board purpose. Falling back to the text board.',
      );
      return null;
    }
  }
}
