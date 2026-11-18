import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import { DISCORD_BOT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { HubForumDiscordDecor } from './hub-forum-discord-decor.apply';
import { listBoundForums } from './hub-forum-discord-decor.queries';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/**
 * The once-ever guard (pattern: ROK-2260's signup-ping catch-up). Bump the
 * suffix to re-run the backfill.
 */
export const FORUM_DECOR_BACKFILL_KEY = 'hub-forum:discord-decor:backfill:v1';

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * ROK-2258 ruling 4 — once, the first time the bot connects with this
 * feature, dress every already-bound forum (tags, 👍, Require tags). Runs on
 * CONNECTED, not at boot, because every step is a Discord call. A failure
 * gives the guard back so the next connect retries; never throws.
 */
@Injectable()
export class HubForumDiscordDecorBackfill {
  private readonly logger = new Logger(HubForumDiscordDecorBackfill.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly decor: HubForumDiscordDecor,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onConnected(): void {
    void this.run(new Date());
  }

  /** Dresses every bound forum when this instance wins the guard; returns how many. */
  async run(now: Date): Promise<number> {
    let won = false;
    try {
      const reply = await this.redis.set(
        FORUM_DECOR_BACKFILL_KEY,
        now.toISOString(),
        'NX',
      );
      won = reply === 'OK';
      if (!won) return 0;
      const forums = await listBoundForums(this.db);
      let done = 0;
      for (const f of forums)
        if (await this.decor.run(f.id, f.channelId)) done++;
      if (done < forums.length)
        throw new Error(`${forums.length - done} forum(s) not dressed`);
      this.logger.log(`Forum decor backfill dressed ${done} forum(s)`);
      return done;
    } catch (err) {
      this.logger.warn(`Forum decor backfill skipped: ${describe(err)}`);
      if (won) await this.release();
      return 0;
    }
  }

  /** A failed backfill gives the guard back for the next connect. */
  private async release(): Promise<void> {
    try {
      await this.redis.del(FORUM_DECOR_BACKFILL_KEY);
    } catch (err) {
      this.logger.warn(
        `Forum decor backfill guard not released: ${describe(err)}`,
      );
    }
  }
}
