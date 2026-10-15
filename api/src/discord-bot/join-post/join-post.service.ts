/**
 * ROK-1740: the pinned "Join Raid Ledger" post — publish, re-post, remove.
 *
 * Idempotency is the whole job (AC2): a stored post is EDITED; it is only
 * re-created when Discord says it is gone (10008); any other failure is a 503
 * that writes nothing, so a flaky Discord never yields a duplicate. Ids are
 * stored right after a send, BEFORE the pin, so a pin failure cannot orphan
 * the message.
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  DiscordJoinPostResult,
  DiscordJoinPostStatus,
} from '@raid-ledger/contract';
import { SettingsService } from '../../settings/settings.service';
import {
  clearJoinPost,
  getJoinPost,
  setJoinPost,
  type JoinPostLocation,
} from '../../settings/settings-join-post.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { isUnknownMessage } from '../discord-bot-client.messages.helpers';
import {
  buildJoinPostEmbed,
  buildJoinPostRow,
} from './join-post-embed.helpers';
import {
  discordErrorCode,
  findOwnJoinPost,
  readStored,
  tryPin,
  type JoinPostChannel,
  type JoinPostMessage,
  type JoinPostPayload,
} from './join-post-message.helpers';
import {
  findTextChannel,
  requireBotContext,
  resolvePostableChannel,
  type JoinPostBotContext,
} from './join-post-channel.helpers';

/** Discord's "Unknown Channel" — the old channel is gone, so is the post. */
const UNKNOWN_CHANNEL = 10003;

export const DISCORD_UNAVAILABLE_MESSAGE =
  "Discord didn't answer — nothing was posted, try again.";

type Located =
  | { message: JoinPostMessage; outcome: 'edited' | 'adopted' }
  | { message: null; outcome: 'created' | 'recreated' };

interface Written {
  message: JoinPostMessage;
  outcome: DiscordJoinPostResult['outcome'];
}

@Injectable()
export class JoinPostService {
  private readonly logger = new Logger(JoinPostService.name);
  /**
   * Tail of the in-flight publish/remove chain. Both read the stored ids,
   * talk to Discord, then write the ids — two overlapping runs would each see
   * "nothing stored" and the store would forget one post. One API process
   * owns the bot, so an in-process queue is the whole lock.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settings: SettingsService,
    private readonly client: DiscordBotClientService,
  ) {}

  /** Where the post lives, if anywhere. */
  async status(): Promise<DiscordJoinPostStatus> {
    return getJoinPost(this.settings);
  }

  /**
   * Post the join message to a channel, or bring the existing one up to date.
   *
   * @param channelId - Target text channel.
   */
  publish(channelId: string): Promise<DiscordJoinPostResult> {
    return this.serialize(() => this.publishNow(channelId));
  }

  /** Delete the post and forget it. */
  remove(): Promise<{ removed: boolean }> {
    return this.serialize(() => this.removeNow());
  }

  /** Run `task` after every earlier publish/remove settles, pass or fail. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async publishNow(channelId: string): Promise<DiscordJoinPostResult> {
    const ctx = requireBotContext(this.client);
    const channel: JoinPostChannel = resolvePostableChannel(ctx, channelId);
    const stored = await getJoinPost(this.settings);
    await this.leaveOldChannel(ctx, stored, channelId);
    const storedId = stored.channelId === channelId ? stored.messageId : null;
    const located = await this.locate(channel, storedId, ctx.botUserId);
    const payload = await this.buildPayload();
    const { message, outcome } = await this.write(channel, located, payload);
    await setJoinPost(this.settings, channelId, message.id);
    const pin = await tryPin(message, (line) => this.logger.warn(line));
    return {
      outcome,
      channelId,
      messageId: message.id,
      ...pin,
    };
  }

  private async removeNow(): Promise<{ removed: boolean }> {
    const stored = await getJoinPost(this.settings);
    if (!stored.channelId || !stored.messageId) {
      await clearJoinPost(this.settings);
      return { removed: false };
    }
    const ctx = requireBotContext(this.client);
    const removed = await this.deleteStored(
      ctx,
      stored.channelId,
      stored.messageId,
    );
    await clearJoinPost(this.settings);
    return { removed };
  }

  /** D3: posting to a new channel deletes the old post first. */
  private async leaveOldChannel(
    ctx: JoinPostBotContext,
    stored: JoinPostLocation,
    channelId: string,
  ): Promise<void> {
    if (!stored.channelId || !stored.messageId) return;
    if (stored.channelId === channelId) return;
    await this.deleteStored(ctx, stored.channelId, stored.messageId);
    await clearJoinPost(this.settings);
  }

  /**
   * Delete a stored post. Already gone (message or channel) answers false;
   * any other failure is a 503 that leaves the stored ids alone.
   */
  private async deleteStored(
    ctx: JoinPostBotContext,
    channelId: string,
    messageId: string,
  ): Promise<boolean> {
    const channel = findTextChannel(ctx.guild, channelId);
    if (!channel) return false;
    try {
      await channel.messages.delete(messageId);
      return true;
    } catch (err) {
      if (isUnknownMessage(err) || discordErrorCode(err) === UNKNOWN_CHANNEL) {
        return false;
      }
      throw this.unavailable('delete', err);
    }
  }

  /** D5/D6: find what to edit, or decide to create. */
  private async locate(
    channel: JoinPostChannel,
    storedId: string | null,
    botUserId: string,
  ): Promise<Located> {
    if (storedId) {
      const message = await readStored(channel, storedId).catch((err) => {
        throw this.unavailable('fetch', err);
      });
      if (message) return { message, outcome: 'edited' };
      // Gone — but a send whose reply was lost may have left an orphan.
      const orphan = await findOwnJoinPost(channel, botUserId);
      return orphan
        ? { message: orphan, outcome: 'adopted' }
        : { message: null, outcome: 'recreated' };
    }
    const found = await findOwnJoinPost(channel, botUserId);
    return found
      ? { message: found, outcome: 'adopted' }
      : { message: null, outcome: 'created' };
  }

  /**
   * Edit the located post, or send a new one. An edit answering 10008 means
   * the post vanished after it was read — re-create it rather than 503.
   */
  private async write(
    channel: JoinPostChannel,
    located: Located,
    payload: JoinPostPayload,
  ): Promise<Written> {
    if (located.message) {
      const edited = await this.tryEdit(located.message, payload);
      if (edited) return { message: edited, outcome: located.outcome };
    }
    const outcome = located.message ? 'recreated' : located.outcome;
    try {
      return { message: await channel.send(payload), outcome };
    } catch (err) {
      throw this.unavailable('send', err);
    }
  }

  /** Edit in place; null when Discord says the message is gone. */
  private async tryEdit(
    message: JoinPostMessage,
    payload: JoinPostPayload,
  ): Promise<JoinPostMessage | null> {
    try {
      await message.edit(payload);
      return message;
    } catch (err) {
      if (isUnknownMessage(err)) return null;
      throw this.unavailable('edit', err);
    }
  }

  private async buildPayload(): Promise<JoinPostPayload> {
    const [branding, clientUrl] = await Promise.all([
      this.settings.getBranding(),
      this.settings.getClientUrl(),
    ]);
    const name = branding.communityName || 'Raid Ledger';
    return {
      embeds: [buildJoinPostEmbed(name)],
      components: [buildJoinPostRow(clientUrl)],
    };
  }

  private unavailable(step: string, err: unknown): ServiceUnavailableException {
    const why = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Join post ${step} failed: ${why}`);
    return new ServiceUnavailableException(DISCORD_UNAVAILABLE_MESSAGE);
  }
}
