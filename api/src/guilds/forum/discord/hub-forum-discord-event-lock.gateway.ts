/**
 * ROK-2208 §5.7 item 4 (R12) — the Discord lock/archive write behind the
 * Core event lock sweep (split out in ROK-2272 S4a so the registry pass in
 * `event-planning-posts.lock.ts` can share it without an import cycle).
 */
import { Injectable } from '@nestjs/common';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { isGone } from './hub-forum-discord-outbound.discord';

const REASON = 'Raid Ledger event discussion is read-only';

/** Lock/archive a forum post behind a plain id (spied on by specs). */
@Injectable()
export class HubForumDiscordEventLockGateway {
  constructor(private readonly client: DiscordBotClientService) {}

  /** Read-only: lock then archive; reopened: unarchive then unlock. */
  async setReadOnly(postId: string, readOnly: boolean): Promise<void> {
    const guild = this.client.isConnected() ? this.client.getGuild() : null;
    if (!guild) throw new Error('Discord bot is offline');
    try {
      const ch = await guild.channels.fetch(postId);
      if (!ch?.isThread()) return;
      if (readOnly) {
        await ch.setLocked(true, REASON);
        await ch.setArchived(true, REASON);
      } else {
        await ch.setArchived(false, REASON);
        await ch.setLocked(false, REASON);
      }
    } catch (err) {
      if (!isGone(err)) throw err;
    }
  }
}
