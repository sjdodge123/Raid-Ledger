/**
 * ROK-2208 §5.4/§5.5 — the gateway edge of the inbound forum sync, shaped
 * like `HubMediaChannelListener`: bound on CONNECTED, detached on
 * DISCONNECTED. Maps discord.js objects to plain data and hands them to
 * `HubForumDiscordInboundIngest`; also pushes RL pin changes to Discord.
 * A Core behaviour (`hub-forum.discord-sync`, §10).
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import {
  ChannelFlags,
  Events,
  type AnyThreadChannel,
  type Message,
  type PartialMessage,
  type ReadonlyCollection,
} from 'discord.js';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { DISCORD_BOT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from '../../../discord-bot/listeners/discord-listener-binding';
import { HUB_FORUM_CHANGED, type HubForumChange } from '../hub-forum.emit';
import { HubForumDiscordInboundIngest } from './hub-forum-discord-inbound.ingest';
import { HubForumDiscordPinSync } from './hub-forum-discord-pins';
import type { InboundMessage, InboundThread } from './hub-forum-discord-route';

type AnyMessage = Message | PartialMessage;
type GatewayBinding = ReturnType<typeof gatewayBinding>;

/** A discord.js message as plain inbound data. */
export function toInboundMessage(m: Message): InboundMessage {
  const named = (id: string, fallback: string): string =>
    m.mentions.members?.get(id)?.displayName ?? fallback;
  const files = [...m.attachments.values(), ...m.stickers.values()];
  return {
    id: m.id,
    threadId: m.channelId,
    authorId: m.author.id,
    authorName:
      m.member?.displayName ?? m.author.globalName ?? m.author.username,
    authorAvatar: m.author.avatar,
    webhookId: m.webhookId,
    content: m.content,
    mentions: new Map(
      m.mentions.users.map((u): [string, string] => [
        u.id,
        named(u.id, u.globalName ?? u.username),
      ]),
    ),
    attachments: files.map((f) => ({ name: f.name, url: f.url })),
  };
}

/** A discord.js thread as plain inbound data. */
export function toInboundThread(t: AnyThreadChannel): InboundThread {
  return {
    id: t.id,
    parentId: t.parentId,
    name: t.name,
    appliedTags: t.appliedTags,
    pinned: t.flags.has(ChannelFlags.Pinned),
    archived: t.archived ?? false,
  };
}

/** Discord forum posts in bound forums → hub Forum rows. */
@Injectable()
export class HubForumDiscordInboundListener {
  private readonly logger = new Logger(HubForumDiscordInboundListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'hub forum sync',
  );
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'hub-forum.discord-sync';
  readonly hubBehaviourKind = 'ingest-source';
  readonly ownerPluginId = CORE_PLUGIN_ID;

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly ingest: HubForumDiscordInboundIngest,
    private readonly pins: HubForumDiscordPinSync,
  ) {}

  /** Bind message + thread events to the live client. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  handleBotConnected(): void {
    this.binding.attachToClient(this.clientService.getClient(), [
      ...this.messageBindings(),
      ...this.threadBindings(),
    ]);
  }

  /** MessageCreate/Update/Delete/BulkDelete → the ingest. */
  private messageBindings(): GatewayBinding[] {
    return [
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
        (ms: ReadonlyCollection<string, AnyMessage>) => {
          this.run('messageBulkDelete', this.onBulkDelete(ms));
        },
      ),
    ];
  }

  /** ThreadUpdate (rename, pin flag) and ThreadDelete → the ingest. */
  private threadBindings(): GatewayBinding[] {
    return [
      gatewayBinding(
        Events.ThreadUpdate,
        (before: AnyThreadChannel, after: AnyThreadChannel) => {
          const work = this.ingest.onThreadUpdate(
            toInboundThread(before),
            toInboundThread(after),
          );
          this.run(
            'threadUpdate',
            work.then(() => undefined),
          );
        },
      ),
      gatewayBinding(Events.ThreadDelete, (t: AnyThreadChannel) => {
        const work = this.ingest.onThreadDelete(toInboundThread(t));
        this.run(
          'threadDelete',
          work.then(() => undefined),
        );
      }),
    ];
  }

  /** Drop the handlers so a reconnect rebinds to the new client. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  handleBotDisconnected(): void {
    this.binding.detach();
  }

  /** R5 RL → Discord: an RL pin/unpin moves the forum's single pin. */
  @OnEvent(HUB_FORUM_CHANGED, { async: true })
  async onForumChange(change: HubForumChange): Promise<void> {
    if (change.op !== 'thread.pinned' && change.op !== 'thread.unpinned')
      return;
    try {
      await this.pins.pushHub(change.guildId);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.error(`Pin sync hub ${change.guildId}: ${why}`);
    }
  }

  private async onCreate(m: Message): Promise<void> {
    const ch = m.channel;
    if (!m.guildId || !ch.isThread()) return;
    const fetchStarter = async (): Promise<InboundMessage | null> => {
      const starter = await ch.fetchStarterMessage().catch(() => null);
      return starter ? toInboundMessage(starter) : null;
    };
    const ctx = { botUserId: this.botUserId(), fetchStarter };
    await this.ingest.onCreate(toInboundMessage(m), toInboundThread(ch), ctx);
  }

  private async onUpdate(m: AnyMessage): Promise<void> {
    if (!m.guildId || !m.channel.isThread()) return;
    const full = m.partial ? await m.fetch() : m;
    await this.ingest.onUpdate(toInboundMessage(full), m.channel.parentId);
  }

  private async onDelete(m: AnyMessage): Promise<void> {
    if (!m.guildId || !m.channel.isThread()) return;
    await this.ingest.onDelete(m.id, m.channel.parentId);
  }

  private async onBulkDelete(
    ms: ReadonlyCollection<string, AnyMessage>,
  ): Promise<void> {
    for (const m of ms.values()) await this.onDelete(m);
  }

  private botUserId(): string | null {
    return this.clientService.getClient()?.user?.id ?? null;
  }

  /** Never let a gateway handler reject. */
  private run(label: string, work: Promise<void>): void {
    work.catch((err: unknown) => {
      this.logger.error(`Forum sync ${label} failed:`, err);
    });
  }
}
