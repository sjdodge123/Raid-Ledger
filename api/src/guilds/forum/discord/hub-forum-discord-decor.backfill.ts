import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CORE_PLUGIN_ID } from '@raid-ledger/contract';
import type Redis from 'ioredis';
import { DISCORD_BOT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import type { DecorOutcome } from './hub-forum-discord-decor';
import { HubForumDiscordDecor } from './hub-forum-discord-decor.apply';
import { listBoundForums } from './hub-forum-discord-decor.queries';
import { HubForumBindLock } from './hub-forum-discord.bind-lock';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/**
 * The once-ever guard (pattern: ROK-2260's signup-ping catch-up). Bump the
 * suffix to re-run the backfill.
 */
export const FORUM_DECOR_BACKFILL_KEY = 'hub-forum:discord-decor:backfill:v1';

/** Review r1: the guard expires while running, so a crash mid-run frees it. */
const RUNNING_TTL_SECONDS = 3600;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * ROK-2258 ruling 4 — once, the first time the bot connects with this
 * feature, dress every already-bound forum (tags, 👍, Require tags). Runs on
 * CONNECTED, not at boot, because every step is a Discord call. A transient
 * failure gives the guard back so the next connect retries; a permanent skip
 * (no Manage Channels, a deleted channel) settles. Never throws.
 */
@Injectable()
export class HubForumDiscordDecorBackfill {
  private readonly logger = new Logger(HubForumDiscordDecorBackfill.name);
  /** Hub behaviour — read by the ownership guard's listener scan. */
  readonly hubBehaviour = 'hub-forum.discord-sync';
  readonly hubBehaviourKind = 'ingest-source';
  readonly ownerPluginId = CORE_PLUGIN_ID;

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly decor: HubForumDiscordDecor,
    private readonly binds: HubForumBindLock,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onConnected(): void {
    void this.run(new Date());
  }

  /** Dresses every bound forum when this instance wins the guard; returns how many. */
  async run(now: Date): Promise<number> {
    let won = false;
    try {
      const stamp = now.toISOString();
      const reply = await this.redis.set(
        FORUM_DECOR_BACKFILL_KEY,
        stamp,
        'EX',
        RUNNING_TTL_SECONDS,
        'NX',
      );
      won = reply === 'OK';
      if (!won) return 0;
      const done = await this.dressAll();
      await this.redis.set(FORUM_DECOR_BACKFILL_KEY, stamp); // settled: no TTL
      return done;
    } catch (err) {
      this.logger.warn(`Forum decor backfill skipped: ${describe(err)}`);
      if (won) await this.release();
      return 0;
    }
  }

  /** Dress each forum; throws when any failed transiently (guard released). */
  private async dressAll(): Promise<number> {
    const forums = await listBoundForums(this.db);
    const outcomes: DecorOutcome[] = [];
    // Codex P2 #2: under the bind lock, so a concurrent bind's tag-list
    // rewrite never drops this run's tags (or the other way round).
    for (const f of forums)
      outcomes.push(
        await this.binds.run(f.discordGuildId, () =>
          this.decor.run(f.id, f.channelId),
        ),
      );
    const count = (o: DecorOutcome): number =>
      outcomes.filter((x) => x === o).length;
    if (count('retry') > 0)
      throw new Error(`${count('retry')} forum(s) not dressed`);
    this.logger.log(
      `Forum decor backfill dressed ${count('done')} forum(s), ` +
        `skipped ${count('settled')} for good`,
    );
    return count('done');
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
