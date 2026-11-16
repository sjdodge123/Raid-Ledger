/**
 * ROK-2208 §5.6 — the reconcile's only Discord seam (spied in specs): the
 * active posts of a bound forum and a post's messages after a snowflake,
 * mapped to the plain shapes the inbound ingest reads.
 */
import { Injectable } from '@nestjs/common';
import { ChannelType, type Channel, type Message } from 'discord.js';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import {
  toInboundMessage,
  toInboundThread,
} from './hub-forum-discord-inbound.listener';
import type { InboundMessage, InboundThread } from './hub-forum-discord-route';

/** Discord's page size for `GET /channels/:id/messages`. */
const PAGE = 100;

const bySnowflake = (a: Message, b: Message): number =>
  BigInt(a.id) < BigInt(b.id) ? -1 : 1;

/** Read-only Discord calls for the reconnect reconcile. */
@Injectable()
export class HubForumDiscordReconcileGateway {
  constructor(private readonly clientService: DiscordBotClientService) {}

  /** The bot's own user id (echo guard D5). */
  botUserId(): string | null {
    return this.clientService.getClient()?.user?.id ?? null;
  }

  /** The forum's ACTIVE posts; archived posts are not walked (§5.6). */
  async activeThreads(channelId: string): Promise<InboundThread[]> {
    const ch = await this.channel(channelId);
    if (!ch || ch.type !== ChannelType.GuildForum) return [];
    const { threads } = await ch.threads.fetchActive();
    return [...threads.values()]
      .filter((t) => t.parentId === channelId)
      .map(toInboundThread);
  }

  /** Up to `max` messages of a post newer than `after`, oldest first. */
  async messagesAfter(
    threadId: string,
    after: string,
    max: number,
  ): Promise<InboundMessage[]> {
    const ch = await this.channel(threadId);
    if (!ch?.isThread()) return [];
    const out: InboundMessage[] = [];
    let cursor = after;
    while (out.length < max) {
      const limit = Math.min(PAGE, max - out.length);
      const page = await ch.messages.fetch({ after: cursor, limit });
      const sorted = [...page.values()].sort(bySnowflake);
      out.push(...sorted.map(toInboundMessage));
      const last = sorted.at(-1);
      if (!last || sorted.length < limit) break;
      cursor = last.id;
    }
    return out;
  }

  private async channel(id: string): Promise<Channel | null> {
    const client = this.clientService.getClient();
    if (!client?.isReady()) return null;
    return client.channels.fetch(id).catch(() => null);
  }
}
