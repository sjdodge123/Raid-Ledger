import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { listUpcomingBoundEventIds } from './hub-forum-discord-signup-pings.queries';
import { HubForumDiscordSignupPingQueue } from './hub-forum-discord-signup-pings.queue';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/**
 * The once-ever guard. In Redis (not app_settings) on purpose: it lives next
 * to the pinged sets it protects — a Redis wipe loses both, and re-running
 * the catch-up is then exactly right. Bump the suffix to re-run it.
 */
export const SIGNUP_PING_CATCH_UP_KEY = 'hub-forum:signup-pings:catch-up:v1';

/**
 * ROK-2260 ruling 5 — once, at the first boot with this feature, arm a flush
 * for every upcoming event in a bound hub so its current signups are pinged.
 * Idempotent anyway: the pinged set stops a second ping. Never blocks or
 * fails the boot.
 */
@Injectable()
export class HubForumDiscordSignupPingCatchUp implements OnApplicationBootstrap {
  private readonly logger = new Logger(HubForumDiscordSignupPingCatchUp.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly queue: HubForumDiscordSignupPingQueue,
  ) {}

  onApplicationBootstrap(): void {
    void this.run(new Date());
  }

  /** Arms the catch-up when this instance wins the guard; returns how many. */
  async run(now: Date): Promise<number> {
    try {
      const won = await this.redis.set(
        SIGNUP_PING_CATCH_UP_KEY,
        now.toISOString(),
        'NX',
      );
      if (won !== 'OK') return 0;
      const ids = await listUpcomingBoundEventIds(this.db, now);
      for (const id of ids) await this.queue.schedule(id);
      this.logger.log(`Signup ping catch-up armed for ${ids.length} event(s)`);
      return ids.length;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Signup ping catch-up skipped: ${why}`);
      return 0;
    }
  }
}
