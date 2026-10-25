/**
 * ROK-1941 — the gateway edge of hub media ingest, shaped like
 * `ThreadMirrorListener`: bound on CONNECTED, detached on DISCONNECTED. Guards
 * only; what to store lives in `HubMediaPostIngest` (plain `PostLike`).
 *
 * D4: only the app's own messages are skipped — never `author.bot` or a
 * webhook, because the screenshot mod posts through a webhook.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  type Message,
  type PartialMessage,
  type ReadonlyCollection,
} from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from '../listeners/discord-listener-binding';
import { isOwnBotMessage } from '../thread-mirror/thread-mirror.helpers';
import { HubMediaChannelResolver } from './hub-media-channel.queries';
import { HubMediaPostIngest } from './hub-media-post.ingest';
import { toPostLike } from './hub-media-post.mapper';

type AnyMessage = Message | PartialMessage;

/** Ingests pictures posted in a hub's bound media channel. */
@Injectable()
export class HubMediaChannelListener {
  private readonly logger = new Logger(HubMediaChannelListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'hub media channel',
  );

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly resolver: HubMediaChannelResolver,
    private readonly ingest: HubMediaPostIngest,
  ) {}

  /** Bind create / update / delete / bulk-delete to the live client. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  handleBotConnected(): void {
    this.binding.attachToClient(this.clientService.getClient(), [
      gatewayBinding(Events.MessageCreate, (m: Message) => {
        this.run('messageCreate', this.onCreate(m));
      }),
      gatewayBinding(Events.MessageUpdate, (_old: AnyMessage, m: AnyMessage) => {
        this.run('messageUpdate', this.onUpdate(m));
      }),
      gatewayBinding(Events.MessageDelete, (m: AnyMessage) => {
        this.run('messageDelete', this.onDelete(m));
      }),
      gatewayBinding(
        Events.MessageBulkDelete,
        (messages: ReadonlyCollection<string, AnyMessage>) => {
          this.run('messageBulkDelete', this.onBulkDelete(messages));
        },
      ),
    ]);
  }

  /** Drop the handlers so a reconnect rebinds to the new client. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  handleBotDisconnected(): void {
    this.binding.detach();
  }

  /** A new post in a bound channel. */
  async onCreate(message: Message): Promise<void> {
    if (this.isOwn(message)) return;
    const hub = await this.hubFor(message);
    if (!hub) return;
    await this.ingest.ingestPost(toPostLike(message), hub);
  }

  /** An edit; an uncached partial is fetched before the own-bot check. */
  async onUpdate(message: AnyMessage): Promise<void> {
    const hub = await this.hubFor(message);
    if (!hub) return;
    const full = message.partial ? await message.fetch() : message;
    if (this.isOwn(full)) return;
    await this.ingest.onEdit(toPostLike(full), hub);
  }

  /** A delete — the message is gone, so only its ids are read. */
  async onDelete(message: AnyMessage): Promise<void> {
    const hub = await this.hubFor(message);
    if (!hub) return;
    await this.ingest.onDelete(message.id, hub);
  }

  /** A bulk delete is N deletes. */
  async onBulkDelete(
    messages: ReadonlyCollection<string, AnyMessage>,
  ): Promise<void> {
    for (const message of messages.values()) await this.onDelete(message);
  }

  private hubFor(message: AnyMessage) {
    if (!message.guildId) return Promise.resolve(null);
    return this.resolver.resolve(message.channelId);
  }

  private isOwn(message: Message): boolean {
    const ownId = this.clientService.getClient()?.user?.id ?? null;
    return isOwnBotMessage({ author: message.author }, ownId);
  }

  /** Never let a gateway handler reject. */
  private run(label: string, work: Promise<void>): void {
    work.catch((err: unknown) => {
      this.logger.error(`Error handling ${label}:`, err);
    });
  }
}
