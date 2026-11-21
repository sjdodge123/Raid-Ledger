/**
 * ROK-2292 D4 — the forum side of the event embed edit seam. The bot's
 * `EventEmbedMessageEditor` hands every forum-starter row here (token
 * `FORUM_STARTER_EDIT_PORT`, bound in `HubForumDiscordModule`), and the
 * outbound gateway edits the starter as whoever authored it: the hub webhook
 * for a hub event post, the bot for an event-planning post.
 */
import { Injectable } from '@nestjs/common';
import type {
  ForumStarterCard,
  ForumStarterEditPort,
} from '../../../discord-bot/services/event-embed-message.editor';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';

@Injectable()
export class ForumStarterEditor implements ForumStarterEditPort {
  constructor(private readonly gateway: HubForumDiscordOutboundGateway) {}

  async editStarter(
    threadId: string,
    card: ForumStarterCard,
  ): Promise<'edited' | 'gone'> {
    const result = await this.gateway.editStarterCard(threadId, card);
    return result === 'ok' ? 'edited' : 'gone';
  }
}
