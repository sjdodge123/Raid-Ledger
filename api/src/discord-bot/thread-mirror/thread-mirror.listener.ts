/**
 * ROK-1483 — the gateway edge of the thread mirror.
 *
 * Shaped exactly like `EventLinkListener`: handlers are attached on
 * `CONNECTED` through a `DiscordListenerBinding` and detached on
 * `DISCONNECTED`, so a reconnect can neither orphan a handler on a destroyed
 * client nor stack two handlers on the live one.
 *
 * This class holds every guard and no logic. Deciding whether a message
 * belongs to the mirror is a gateway concern; deciding what to store is the
 * service's, and keeping them apart is what lets the service be tested without
 * a `Message` fixture.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  type Message,
  type MessageReaction,
  type PartialMessage,
  type PartialMessageReaction,
} from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from '../listeners/discord-listener-binding';
import {
  isOwnBotMessage,
  type MirrorMessageAuthor,
} from './thread-mirror.helpers';
import { ThreadMirrorService } from './thread-mirror.service';
import {
  ThreadSurfaceRegistry,
  type ResolvedThread,
} from './thread-surface.registry';

/** The slice of a gateway message every guard here reads. */
interface GatewayMessageLike {
  author: MirrorMessageAuthor | null;
  guild: { id: string } | null;
  channel: { id: string; isThread(): boolean };
}

/** Mirrors messages posted in app-owned threads. */
@Injectable()
export class ThreadMirrorListener {
  private readonly logger = new Logger(ThreadMirrorListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'thread mirror',
  );

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly registry: ThreadSurfaceRegistry,
    private readonly mirror: ThreadMirrorService,
  ) {}

  /** Bind create/update/delete to the live client. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  handleBotConnected(): void {
    this.binding.attachToClient(this.clientService.getClient(), [
      gatewayBinding(Events.MessageCreate, (message: Message) => {
        this.run('messageCreate', this.onCreate(message));
      }),
      gatewayBinding(
        Events.MessageUpdate,
        (_old: Message | PartialMessage, message: Message | PartialMessage) => {
          this.run('messageUpdate', this.onUpdate(message));
        },
      ),
      gatewayBinding(
        Events.MessageDelete,
        (message: Message | PartialMessage) => {
          this.run('messageDelete', this.onDelete(message));
        },
      ),
      // ROK-1506 — the four reaction events. The reactor `user` argument is
      // deliberately never read: counts only (AC4).
      gatewayBinding(
        Events.MessageReactionAdd,
        (reaction: MessageReaction | PartialMessageReaction) => {
          this.run('messageReactionAdd', this.onReaction(reaction.message));
        },
      ),
      gatewayBinding(
        Events.MessageReactionRemove,
        (reaction: MessageReaction | PartialMessageReaction) => {
          this.run('messageReactionRemove', this.onReaction(reaction.message));
        },
      ),
      gatewayBinding(
        Events.MessageReactionRemoveAll,
        (message: Message | PartialMessage) => {
          this.run('messageReactionRemoveAll', this.onReactionsCleared(message));
        },
      ),
      gatewayBinding(
        Events.MessageReactionRemoveEmoji,
        (reaction: MessageReaction | PartialMessageReaction) => {
          this.run(
            'messageReactionRemoveEmoji',
            this.onReaction(reaction.message),
          );
        },
      ),
    ]);
  }

  /** Drop the handlers so a reconnect rebinds to the new client. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  handleBotDisconnected(): void {
    this.binding.detach();
  }

  /** A new message in a mirrored thread. */
  async onCreate(message: Message): Promise<void> {
    const bound = await this.bindingFor(message);
    if (!bound) return;
    await this.mirror.onMessageCreate(message, bound.threadId, bound.guildId);
  }

  /** An edit, possibly delivered as an uncached partial (D6). */
  async onUpdate(message: Message | PartialMessage): Promise<void> {
    const bound = await this.bindingFor(message);
    if (!bound) return;
    await this.mirror.onMessageUpdate(message, bound.threadId, bound.guildId);
  }

  /** A delete. The message is gone, so nothing here may fetch it (D6). */
  async onDelete(message: Message | PartialMessage): Promise<void> {
    const bound = await this.bindingFor(message);
    if (!bound) return;
    await this.mirror.onMessageDelete(message);
  }

  /**
   * A reaction changed on a message (ROK-1506). The only guard here is the
   * free `guildId` read (a DM can never be mirrored); the by-`message_id`
   * gate lives in the service, which holds the db handle (D4).
   */
  async onReaction(message: Message | PartialMessage): Promise<void> {
    if (!message.guildId) return;
    await this.mirror.onReactionChange(message, { cleared: false });
  }

  /** Every reaction on a message was removed at once — the set is `[]`. */
  async onReactionsCleared(message: Message | PartialMessage): Promise<void> {
    if (!message.guildId) return;
    await this.mirror.onReactionChange(message, { cleared: true });
  }

  /**
   * The thread a message should be mirrored into, or null when a guard
   * rejects it.
   *
   * The order is deliberate and each step is cheaper than the next: the own-bot
   * check and the guild/thread checks are synchronous field reads, and only a
   * message that survives all three costs a database round trip in the
   * registry. Inverting them would put a query on every message in the guild.
   *
   * @param message - The gateway message.
   * @returns The thread and guild to mirror into, or null.
   */
  private async bindingFor(
    message: GatewayMessageLike,
  ): Promise<ResolvedThread | null> {
    const ownId = this.clientService.getClient()?.user?.id ?? null;
    // An uncached `messageUpdate` partial carries `author === null`, so this
    // guard cannot decide and must NOT drop the message: the partial is passed
    // through and `ThreadMirrorService.onMessageUpdate` re-asserts D9 on the
    // FETCHED message, which is the only shape that can answer the question.
    if (message.author && isOwnBotMessage({ author: message.author }, ownId)) {
      return null;
    }
    if (!message.guild) return null;
    if (!message.channel.isThread()) return null;
    const surface = await this.registry.resolveSurface(message.channel.id);
    if (!surface) return null;
    return { threadId: message.channel.id, guildId: message.guild.id };
  }

  /** Never let a gateway handler reject — an unhandled rejection kills nothing
   * visibly and hides the mirror going silent. */
  private run(label: string, work: Promise<void>): void {
    work.catch((err: unknown) => {
      this.logger.error(`Error handling ${label}:`, err);
    });
  }
}
