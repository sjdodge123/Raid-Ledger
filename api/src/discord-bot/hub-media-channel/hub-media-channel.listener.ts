/**
 * ROK-1941 — the gateway edge of hub media ingest, shaped like
 * `ThreadMirrorListener`: bound on CONNECTED, detached on DISCONNECTED. Guards
 * only; what to store lives in `HubMediaPostIngest` (plain `PostLike`).
 *
 * D4: only the app's own messages are skipped — never `author.bot` or a
 * webhook, because the screenshot mod posts through a webhook.
 *
 * Ingest work runs through the shared `HubMediaIngestPool` only once the
 * channel resolves to a hub, so unrelated guild traffic never takes a slot.
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
import { HubMediaChannelResolver } from './hub-media-channel.queries';
import {
  HubMediaIngestPool,
  HubMediaIngestQueueFullError,
} from './hub-media-ingest.pool';
import { HubMediaPostIngest, isOwnAuthor } from './hub-media-post.ingest';
import { toPostLike, type GatewayPost } from './hub-media-post.mapper';

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
    private readonly pool: HubMediaIngestPool,
  ) {}

  /** Bind create / update / delete / bulk-delete to the live client. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  handleBotConnected(): void {
    this.binding.attachToClient(this.clientService.getClient(), [
      gatewayBinding(Events.MessageCreate, (m: Message) => {
        this.run('messageCreate', this.onCreate(m));
      }),
      gatewayBinding(
        Events.MessageUpdate,
        (_old: AnyMessage, m: AnyMessage) => {
          this.run('messageUpdate', this.onUpdate(m));
        },
      ),
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
  async onCreate(message: GatewayPost): Promise<void> {
    if (this.isOwn(message)) return;
    const hub = await this.hubFor(message);
    if (!hub) return;
    const post = toPostLike(message);
    await this.pool.run(`create ${post.id}`, () =>
      this.ingest.ingestPost(post, hub),
    );
  }

  /** An edit; an uncached partial is fetched before the own-bot check. */
  async onUpdate(message: AnyMessage): Promise<void> {
    const hub = await this.hubFor(message);
    if (!hub) return;
    const full = message.partial ? await message.fetch() : message;
    if (this.isOwn(full)) return;
    const post = toPostLike(full);
    await this.pool.run(`edit ${post.id}`, () => this.ingest.onEdit(post, hub));
  }

  /** A delete — only its ids are read; never dropped by the pool. */
  async onDelete(message: AnyMessage): Promise<void> {
    const hub = await this.hubFor(message);
    if (!hub) return;
    const { id } = message;
    await this.pool.run(
      `delete ${id}`,
      () => this.ingest.onDelete(id, hub),
      'essential',
    );
  }

  /** A bulk delete is N deletes. */
  async onBulkDelete(
    messages: ReadonlyCollection<string, AnyMessage>,
  ): Promise<void> {
    for (const message of messages.values()) await this.onDelete(message);
  }

  private hubFor(message: { guildId: string | null; channelId: string }) {
    if (!message.guildId) return Promise.resolve(null);
    return this.resolver.resolve(message.channelId);
  }

  /** D4 early-out (edits never reach `ingestPost`); the rule is `isOwnAuthor`. */
  private isOwn(message: GatewayPost): boolean {
    return isOwnAuthor(this.clientService, message.author.id);
  }

  /** Never let a gateway handler reject. */
  private run(label: string, work: Promise<void>): void {
    work.catch((err: unknown) => {
      if (err instanceof HubMediaIngestQueueFullError) return; // pool warned
      this.logger.error(`Error handling ${label}:`, err);
    });
  }
}
