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
  isPinned,
  pickIntro,
  type IntroCandidate,
} from './lfg-board-discovery.helpers';
import {
  LFG_BOARD_EVENTS,
  LFG_BOARD_INTRO_BODY,
  LFG_BOARD_INTRO_TITLE,
  type LfgBoardToggledPayload,
} from './lfg-board.constants';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';

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
  /**
   * Count the forums this board owns, once per connection.
   *
   * `resolveMarked` already warns when it adopts one of several, but only the
   * next time a group actually resolves — so a guild can quietly accumulate
   * duplicate boards for days and the first symptom is somebody eyeballing the
   * channel list. This makes the count announce itself at startup instead.
   *
   * Advisory only: it never throws, never creates, never adopts and never
   * writes a setting. A census that could change state would be a second
   * provisioning path competing with {@link provision}.
   *
   * NOTE it can only see forums carrying the sentinel. Boards created before
   * ROK-1492 taught the board to mark itself have no sentinel and are
   * invisible here — that is exactly how 16 strays went unnoticed in the dev
   * guild, and they had to be removed by hand.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async onBotConnected(): Promise<void> {
    try {
      const guild = this.clientService.getGuild();
      if (!guild) return;
      const forums = await this.channelService.findMarkedForums(guild);
      if (forums.length <= 1) return;
      this.logger.warn(
        `LFG board census: ${String(forums.length)} forums in ${guild.name} ` +
          `carry the board sentinel (${forums.map((f) => f.id).join(', ')}). ` +
          'Exactly one is expected — the oldest is adopted and the rest are ' +
          'inert. Delete the extras, or bind the one you want with the ' +
          'lfg-board purpose.',
      );
    } catch (err) {
      this.logger.warn(`LFG board census failed: ${describeError(err)}.`);
    }
  }

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
   * D6 / ROK-1492 AC2 — adopt the intro post the forum already carries.
   *
   * The settings keys are excluded from sanitised backups on purpose (D7), so
   * after a restore the id is gone while the forum and its pinned intro are
   * still in Discord. Seeding here pins a second "How this board works" to a
   * public forum on every enable. Reached ONLY when no id is stored: an
   * unreadable stored id never gets here.
   *
   * Advisory throughout — a failed scan means "seed one", never a throw.
   *
   * @param forum - The board's forum channel.
   * @returns `present` when one was adopted, otherwise `absent` (seed one).
   */
  private async rediscoverIntro(forum: ForumChannel): Promise<IntroPostState> {
    const botUserId = this.clientService.getBotUser()?.id ?? null;
    if (!botUserId) {
      this.logger.warn(
        'No stored LFG board intro post, and the bot cannot name its own ' +
          'user, so an existing intro cannot be told from a member\u2019s post. ' +
          'Seeding one instead of adopting on the title alone.',
      );
      return 'absent';
    }
    const found = await this.scanForIntro(forum, botUserId);
    if (!found) return 'absent';

    await setLfgBoardIntroThreadId(this.settingsService, found.id);
    await this.pinAdopted(found);
    this.logger.log(
      `Adopted the existing LFG board intro post ${found.id} in forum ` +
        `${forum.id} and re-stored its id; no second intro was seeded.`,
    );
    return 'present';
  }

  /**
   * The board's own intro post among the forum's active posts, or null.
   *
   * A pinned forum post is never archived, so the active list is sufficient
   * (A3). A rejected scan is `null`, not a throw: with no stored id there is
   * nothing to protect, and a duplicate intro is recoverable while a board
   * with no intro is the state the operator just asked to leave (P7).
   *
   * @param forum - The board's forum channel.
   * @param botUserId - The app's own Discord user id.
   */
  private async scanForIntro(
    forum: ForumChannel,
    botUserId: string,
  ): Promise<IntroCandidate | null> {
    try {
      const active = await timedDiscordCall('lfgBoard.introScan', () =>
        forum.threads.fetchActive(),
      );
      return pickIntro([...active.threads.values()], botUserId);
    } catch (err) {
      this.logger.warn(
        `Could not scan the LFG board forum for an existing intro post: ` +
          `${describeError(err)}. Seeding one.`,
      );
      return null;
    }
  }

  /** Put an adopted intro back on top, unless it is already pinned. */
  private async pinAdopted(thread: IntroCandidate): Promise<void> {
    if (isPinned(thread)) return;
    await thread
      .pin('Raid Ledger LFG board intro post')
      .catch((err: unknown) => {
        this.logger.warn(
          `Adopted the LFG board intro post ${thread.id} but could not pin ` +
            `it: ${describeError(err)}. Pin it by hand if you want it on top.`,
        );
      });
  }

  /**
   * What the stored intro post's id currently resolves to.
   *
   * NO stored id defers to {@link rediscoverIntro} (D6), which may adopt one.
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
    if (!stored) return this.rediscoverIntro(forum);
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
