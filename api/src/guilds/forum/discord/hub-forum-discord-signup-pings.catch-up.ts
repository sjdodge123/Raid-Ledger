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
    let won = false;
    try {
      const reply = await this.redis.set(
        SIGNUP_PING_CATCH_UP_KEY,
        now.toISOString(),
        'NX',
      );
      won = reply === 'OK';
      if (!won) return 0;
      const ids = await listUpcomingBoundEventIds(this.db, now);
      const armed = await this.armAll(ids);
      if (armed < ids.length)
        throw new Error(`${ids.length - armed} not armed`);
      this.logger.log(`Signup ping catch-up armed for ${armed} event(s)`);
      return armed;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Signup ping catch-up skipped: ${why}`);
      if (won) await this.release();
      return 0;
    }
  }

  /** Arms every event, even past a failure; returns how many armed. */
  private async armAll(ids: readonly number[]): Promise<number> {
    let armed = 0;
    for (const id of ids) if (await this.queue.schedule(id)) armed++;
    return armed;
  }

  /** Review r1 m5 / Codex P2-3: a failed catch-up gives the guard back for the next boot. */
  private async release(): Promise<void> {
    try {
      await this.redis.del(SIGNUP_PING_CATCH_UP_KEY);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Signup ping catch-up guard not released: ${why}`);
    }
  }
}
