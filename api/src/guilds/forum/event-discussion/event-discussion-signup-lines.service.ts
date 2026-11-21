import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { DiscordEmojiService } from '../../../discord-bot/services/discord-emoji.service';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import {
  signupLineEmoji,
  type SignupLineEmoji,
} from '../discord/hub-forum-discord-signup-lines';
import { lineResyncKey } from '../discord/hub-forum-discord-signup-lines.flush';
import type { ForumDiscordDb } from '../discord/hub-forum-discord.queries';
import { plainLineEmoji, planRlLines } from './event-discussion-signup-lines';
import {
  writeRlSignupLines,
  type RlLineOutcome,
} from './event-discussion-signup-lines.writes';

/**
 * What an RL pass did, plus the reset flag read before and after its signup
 * read (null/null when it never read the signups), so the Discord flush can
 * take a flag nobody else will (an unbound hub).
 */
export interface RlLineFlush {
  outcome: RlLineOutcome | 'failed';
  flags: [string | null, string | null];
}

/**
 * ROK-2274 — signup lines inside a hub event's Raid Ledger thread, bound to
 * Discord or not (ruling Q1). Run by the signup-ping flush BEFORE its
 * Discord half (D5): same debounce, same triggers, same reset flag.
 */
@Injectable()
export class EventDiscussionSignupLines {
  private readonly logger = new Logger(EventDiscussionSignupLines.name);
  private readonly lineEmoji: SignupLineEmoji;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    emoji: DiscordEmojiService,
  ) {
    // Codex P2-3: plain text — the RL thread cannot render `<:rl_tank:…>`.
    this.lineEmoji = plainLineEmoji(signupLineEmoji(emoji));
  }

  /**
   * Never throws, so a DB hiccup here cannot hold back the Discord lines.
   * Nothing is lost: the transaction rolled back, so the next flush's diff
   * still carries the change.
   */
  async flush(eventId: number): Promise<RlLineFlush> {
    try {
      return await this.write(eventId);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.error(`RL signup lines for event ${eventId}: ${why}`);
      return { outcome: 'failed', flags: [null, null] };
    }
  }

  private async write(eventId: number): Promise<RlLineFlush> {
    const key = lineResyncKey(eventId);
    const flags: RlLineFlush['flags'] = [await this.redis.get(key), null];
    const outcome = await writeRlSignupLines(
      this.db,
      eventId,
      new Date(),
      async (prior, members) => {
        flags[1] = await this.redis.get(key);
        const resyncing = flags[0] !== null || flags[1] !== null;
        return planRlLines(prior, members, this.lineEmoji, resyncing);
      },
    );
    return { outcome, flags };
  }
}
