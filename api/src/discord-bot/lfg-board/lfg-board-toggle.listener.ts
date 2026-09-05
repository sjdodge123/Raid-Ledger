/**
 * ROK-1471 D3/E1/E4 — provisioning the board when the operator flips it on.
 *
 * The toggle endpoint persists the setting and emits; ALL Discord work happens
 * here, for two reasons:
 *
 *  1. **The operator gets a 200 either way.** This handler runs inside
 *     `EventEmitter2`'s call stack, whose emitter is `PUT
 *     /admin/settings/discord-bot/lfg-board`. A missing `Manage Channels`
 *     grant must degrade to a warning in the log (E1), never a 500 on a
 *     successful save — so nothing here throws.
 *  2. **Enabling is idempotent.** Re-flipping the toggle reuses the forum the
 *     bot already made (via `LfgBoardChannelService`) and the intro post whose
 *     id is stored in settings, so the board never accumulates duplicates.
 *
 * Disabling deliberately does nothing to Discord (E4): live forum posts keep
 * editing and archive on their own terms, and new groups simply fall back to
 * the 1454 text board.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ForumChannel, Guild } from 'discord.js';
import { SettingsService } from '../../settings/settings.service';
import {
  getLfgBoardIntroThreadId,
  setLfgBoardIntroThreadId,
} from '../../settings/settings-lfg-board.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { isUnknownMessageError } from '../services/embed-poster.helpers';
import { timedDiscordCall } from '../services/scheduled-event.helpers';
import { LfgBoardChannelService } from './lfg-board-channel.service';
import {
  LFG_BOARD_EVENTS,
  LFG_BOARD_INTRO_BODY,
  LFG_BOARD_INTRO_TITLE,
  type LfgBoardToggledPayload,
} from './lfg-board.constants';

/** Best-effort message for a caught `unknown`, never a bare cast. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Discord's "that channel/thread does not exist" API error code. */
const UNKNOWN_CHANNEL_CODE = 10003;

/**
 * Whether a failed thread fetch proves the thread is GONE, as opposed to
 * Discord merely being unable to answer right now.
 *
 * Only the first justifies re-seeding: a rate-limit or a 5xx that is read as
 * "absent" pins a second intro post to a public forum and orphans the first.
 */
function isThreadGoneError(err: unknown): boolean {
  if (isUnknownMessageError(err)) return true;
  if (!(err instanceof Error)) return false;
  const { code } = err as Error & { code?: number };
  return (
    code === UNKNOWN_CHANNEL_CODE || err.message.includes('Unknown Channel')
  );
}

/** What a lookup of the stored intro post could establish. */
type IntroPostState = 'present' | 'absent' | 'unreadable';

@Injectable()
export class LfgBoardToggleListener {
  private readonly logger = new Logger(LfgBoardToggleListener.name);

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly channelService: LfgBoardChannelService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * React to the master toggle: provision on enable, log on disable.
   *
   * @param payload - The new state of the toggle.
   */
  @OnEvent(LFG_BOARD_EVENTS.TOGGLED)
  async onToggled(payload: LfgBoardToggledPayload): Promise<void> {
    if (!payload.enabled) {
      this.logger.log(
        'LFG board disabled — new groups fall back to the text board. Live ' +
          'forum posts keep updating and archive normally (E4).',
      );
      return;
    }
    await this.provision();
  }

  /** Ensure the forum exists and carries exactly one intro post. */
  private async provision(): Promise<void> {
    if (!this.clientService.isConnected()) {
      this.logger.log(
        'LFG board enabled while the bot is offline — the forum will be ' +
          'created the first time a group needs it.',
      );
      return;
    }

    const guild = this.clientService.getGuild();
    if (!guild) {
      this.logger.log(
        'LFG board enabled, but the bot is in no guild — nothing to provision.',
      );
      return;
    }

    const forum = await this.resolveForum(guild);
    if (!forum) return;
    await this.ensureIntroPost(forum);
  }

  /** The board forum, or null (already logged) when it could not be had. */
  private async resolveForum(guild: Guild): Promise<ForumChannel | null> {
    try {
      const forum = await this.channelService.resolveForum(guild);
      if (!forum) {
        this.logger.warn(
          'LFG board enabled, but no forum could be resolved or created. ' +
            'Grant the bot Manage Channels, or bind an existing forum with ' +
            'the lfg-board purpose.',
        );
      }
      return forum;
    } catch (err) {
      this.logger.warn(
        `Could not resolve the LFG board forum: ${describeError(err)}.`,
      );
      return null;
    }
  }

  /** Create + pin the intro post, unless the stored one is still there. */
  private async ensureIntroPost(forum: ForumChannel): Promise<void> {
    try {
      // 'unreadable' is deliberately NOT 'absent' — see `introPostState`.
      if ((await this.introPostState(forum)) !== 'absent') return;

      const thread = await timedDiscordCall('lfgBoard.intro', () =>
        forum.threads.create({
          name: LFG_BOARD_INTRO_TITLE,
          message: { content: LFG_BOARD_INTRO_BODY },
          reason: 'Raid Ledger LFG board intro post',
        }),
      );
      await setLfgBoardIntroThreadId(this.settingsService, thread.id);
      await thread.pin().catch((err: unknown) => {
        this.logger.warn(
          `Seeded the LFG board intro post but could not pin it: ` +
            `${describeError(err)}. Pin it by hand if you want it on top.`,
        );
      });
      this.logger.log(
        `Seeded the LFG board intro post ${thread.id} in forum ${forum.id}.`,
      );
    } catch (err) {
      this.logger.warn(
        `Could not seed the LFG board intro post: ${describeError(err)}.`,
      );
    }
  }

  /**
   * What the stored intro post's id currently resolves to.
   *
   * A stored id that Discord says does not exist (deleted post, wiped forum,
   * E3) is `absent`, so the next enable re-seeds exactly one. Any OTHER
   * failure is `unreadable`, not `absent`: treating a rate-limit or a 5xx as
   * "gone" is what makes the toggle non-idempotent, because it creates and
   * pins a duplicate intro and overwrites the stored id, orphaning the
   * original at the top of a public forum.
   *
   * @param forum - The board's forum channel.
   * @returns `present`, `absent`, or `unreadable`. Never throws.
   */
  private async introPostState(forum: ForumChannel): Promise<IntroPostState> {
    const stored = await getLfgBoardIntroThreadId(this.settingsService);
    if (!stored) return 'absent';
    try {
      const thread = await forum.threads.fetch(stored);
      return thread ? 'present' : 'absent';
    } catch (err) {
      if (isThreadGoneError(err)) return 'absent';
      this.logger.warn(
        `Could not read the stored LFG board intro post ${stored}: ` +
          `${describeError(err)}. Leaving the board as it is — re-flip the ` +
          `toggle once Discord answers, rather than pin a duplicate intro.`,
      );
      return 'unreadable';
    }
  }
}
