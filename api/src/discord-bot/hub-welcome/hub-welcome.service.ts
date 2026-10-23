/**
 * ROK-1933 Part 4 — the hub welcome embed in a hub's linked Discord channel:
 * post, edit in place, move, remove. The ROK-1740 join-post recipe (D10):
 *
 * - same channel + stored id → EDIT; Unknown Message (10008) only → re-post;
 *   any other Discord failure is a 503 that writes nothing (no duplicate);
 * - no stored id → scan pins/history for our own welcome before posting;
 * - a different channel → post in the new one, store it, delete the old;
 * - pin refusal → `warning`, never a failure;
 * - channel cleared → delete the stored message, clear the ids.
 *
 * v1 is Valheim server hubs only (Q8): other hubs are skipped by the event
 * path and refused (400) by the re-post route.
 */
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { HubWelcomeResult } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { VALHEIM_GAME_SLUG } from '../../plugins/valheim/valheim.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { isUnknownMessage } from '../discord-bot-client.messages.helpers';
import {
  findTextChannel,
  requireBotContext,
  type JoinPostBotContext,
} from '../join-post/join-post-channel.helpers';
import {
  discordErrorCode,
  tryPin,
  type JoinPostPayload,
} from '../join-post/join-post-message.helpers';
import {
  buildHubWelcomeEmbed,
  buildHubWelcomeRow,
} from './hub-welcome-embed.helpers';
import {
  HUB_WELCOME_COPY,
  HUB_WELCOME_VALHEIM_COPY,
} from './hub-welcome.constants';
import {
  locateHubWelcome,
  writeHubWelcome,
} from './hub-welcome-message.helpers';
import {
  clearWelcome,
  findWelcomeTarget,
  saveWelcome,
  type HubWelcomeTarget,
} from './hub-welcome.queries';

/** Discord's "Unknown Channel": the old channel is gone, so is the post. */
const UNKNOWN_CHANNEL = 10003;

export const HUB_WELCOME_ERRORS = {
  notFound: 'Hub not found',
  unsupported: 'Welcome messages are only posted for Valheim server hubs.',
  noChannel: 'Link a Discord channel to this hub first.',
  notText: "The hub's channel isn't a text channel the bot can see.",
  unavailable: "Discord didn't answer — nothing was posted, try again.",
} as const;

/** Whether a hub gets a welcome in v1 (Q8): Valheim server hubs only. */
export function isWelcomeHub(target: HubWelcomeTarget): boolean {
  return target.kind === 'game_server' && target.gameSlug === VALHEIM_GAME_SLUG;
}

@Injectable()
export class HubWelcomeService {
  private readonly logger = new Logger(HubWelcomeService.name);
  /** One in-flight write at a time: each run reads ids, posts, writes ids. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly client: DiscordBotClientService,
  ) {}

  /**
   * The re-post route: edit-or-post into the hub's currently bound channel.
   *
   * @throws NotFoundException · BadRequestException (not a Valheim server
   * hub, no channel, not a text channel) · ServiceUnavailableException.
   */
  repost(guildId: number): Promise<HubWelcomeResult> {
    return this.serialize(async () => {
      const target = await findWelcomeTarget(this.db, guildId);
      if (!target) throw new NotFoundException(HUB_WELCOME_ERRORS.notFound);
      if (!isWelcomeHub(target)) {
        throw new BadRequestException(HUB_WELCOME_ERRORS.unsupported);
      }
      if (!target.boundChannelId) {
        throw new BadRequestException(HUB_WELCOME_ERRORS.noChannel);
      }
      return this.publishNow(target, target.boundChannelId);
    });
  }

  /**
   * `hub.channel.linked`: welcome the hub in `channelId`. Uses the payload's
   * channel, never the binding row — the auto-link path announces before its
   * transaction commits. Null when the hub gets no welcome.
   */
  welcomeLinked(
    guildId: number,
    channelId: string,
  ): Promise<HubWelcomeResult | null> {
    return this.serialize(async () => {
      const target = await findWelcomeTarget(this.db, guildId);
      if (!target || !isWelcomeHub(target)) return null;
      return this.publishNow(target, channelId);
    });
  }

  /** `hub.channel.cleared`: delete the stored welcome and forget it. */
  removeWelcome(guildId: number): Promise<boolean> {
    return this.serialize(async () => {
      const target = await findWelcomeTarget(this.db, guildId);
      if (!target?.welcomeChannelId || !target.welcomeMessageId) return false;
      const ctx = requireBotContext(this.client);
      const removed = await this.deleteMessage(
        ctx,
        target.welcomeChannelId,
        target.welcomeMessageId,
      );
      await clearWelcome(this.db, guildId);
      return removed;
    });
  }

  /** Run `task` after every earlier write settles, pass or fail. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async publishNow(
    target: HubWelcomeTarget,
    channelId: string,
  ): Promise<HubWelcomeResult> {
    const ctx = requireBotContext(this.client);
    const channel = findTextChannel(ctx.guild, channelId);
    if (!channel) throw new BadRequestException(HUB_WELCOME_ERRORS.notText);
    const sameChannel = target.welcomeChannelId === channelId;
    const storedId = sameChannel ? target.welcomeMessageId : null;
    const payload = await this.buildPayload(target);
    const { message, result } = await this.discord('write', async () => {
      const located = await locateHubWelcome(
        channel,
        storedId,
        ctx.botUserId,
        target.name,
      );
      return writeHubWelcome(channel, located, payload);
    });
    await saveWelcome(this.db, target.guildId, channelId, message.id);
    if (!sameChannel) await this.leaveOldChannel(ctx, target);
    const pin = await tryPin(
      message,
      (line) => this.logger.warn(`Hub ${target.guildId} welcome: ${line}`),
      HUB_WELCOME_COPY.pinReason,
    );
    return { result, ...pin };
  }

  /** Q9: after posting in the new channel, remove the old welcome. */
  private async leaveOldChannel(
    ctx: JoinPostBotContext,
    target: HubWelcomeTarget,
  ): Promise<void> {
    if (!target.welcomeChannelId || !target.welcomeMessageId) return;
    try {
      await this.deleteMessage(
        ctx,
        target.welcomeChannelId,
        target.welcomeMessageId,
      );
    } catch (err) {
      // The new welcome is live and stored; an old leftover is cosmetic.
      this.logger.warn(
        `Hub ${target.guildId}: old welcome not deleted: ${describe(err)}`,
      );
    }
  }

  /**
   * Delete a message. Already gone (message or channel) answers false; any
   * other failure is rethrown so the caller keeps the stored ids.
   */
  private async deleteMessage(
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
      throw err;
    }
  }

  private async buildPayload(
    target: HubWelcomeTarget,
  ): Promise<JoinPostPayload> {
    const [branding, clientUrl] = await Promise.all([
      this.settings.getBranding(),
      this.settings.getClientUrl(),
    ]);
    const embed = buildHubWelcomeEmbed({
      hubId: target.guildId,
      hubName: target.name,
      description: HUB_WELCOME_VALHEIM_COPY.description(target.name),
      claimHint: HUB_WELCOME_VALHEIM_COPY.claimHint,
      communityName: branding.communityName || null,
    });
    const row = buildHubWelcomeRow({
      hubId: target.guildId,
      clientUrl,
      withClaim: true,
    });
    return { embeds: [embed], components: [row] };
  }

  /** Run a Discord step; anything but an HTTP exception becomes a 503. */
  private async discord<T>(step: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Hub welcome ${step} failed: ${describe(err)}`);
      throw new ServiceUnavailableException(HUB_WELCOME_ERRORS.unavailable);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
