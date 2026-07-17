/**
 * Quota-exhaustion cooldown latch (ROK-1376).
 *
 * When a pre-gen job hits the provider quota/spend-cap wall, further
 * LLM calls are doomed until billing resets — so the processor arms a
 * Redis TTL key and every pre-gen job (plus the cold-cache read path)
 * checks it before dispatching. Redis (not process memory) so the API
 * and BullMQ workers share the latch and it survives restarts within
 * the TTL. The key rides the pre-gen queue's existing ioredis
 * connection — no new Redis provider.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AI_SUGGESTIONS_PREGEN_QUEUE } from './pre-gen.queue';

/** Redis key holding the cooldown latch (value = ISO timestamp armed). */
export const QUOTA_COOLDOWN_KEY = 'ai-suggestions:quota-cooldown';

/** Back-off window after a quota failure (plan: ~15–60 min). */
export const QUOTA_COOLDOWN_TTL_S = 30 * 60;

@Injectable()
export class AiQuotaCooldownService {
  private readonly logger = new Logger(AiQuotaCooldownService.name);

  constructor(
    @InjectQueue(AI_SUGGESTIONS_PREGEN_QUEUE) private readonly queue: Queue,
  ) {}

  /** Arm (or re-arm) the cooldown. Never throws — the latch is advisory. */
  async activate(ttlSeconds: number = QUOTA_COOLDOWN_TTL_S): Promise<void> {
    try {
      const client = await this.queue.client;
      await client.set(
        QUOTA_COOLDOWN_KEY,
        new Date().toISOString(),
        'EX',
        ttlSeconds,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to arm quota cooldown: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * True while the cooldown TTL is live. Fails OPEN (false) on Redis
   * errors — a latch hiccup must never block reads or pre-gen.
   */
  async isActive(): Promise<boolean> {
    try {
      const client = await this.queue.client;
      return (await client.exists(QUOTA_COOLDOWN_KEY)) === 1;
    } catch {
      return false;
    }
  }
}
