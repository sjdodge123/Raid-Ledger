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

/** Un-prefixed latch key; always combined with the queue's prefix. */
const QUOTA_COOLDOWN_KEY_BASE = 'ai-suggestions:quota-cooldown';

/**
 * Full Redis key holding the latch (value = ISO timestamp armed),
 * namespaced under the SAME prefix BullMQ uses for the queue's own keys
 * (`bull` in prod, the per-spec BULLMQ_KEY_PREFIX in integration tests).
 * The latch is written through the RAW ioredis client, which BullMQ's
 * `prefix` option does NOT apply to — without folding the prefix in
 * here, every environment sharing a Redis (integration specs, the local
 * dev env on raid-ledger-redis) would arm/clear ONE global key.
 */
export function quotaCooldownKey(prefix: string | undefined): string {
  return `${prefix ?? 'bull'}:${QUOTA_COOLDOWN_KEY_BASE}`;
}

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
        quotaCooldownKey(this.queue.opts.prefix),
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
      return (
        (await client.exists(quotaCooldownKey(this.queue.opts.prefix))) === 1
      );
    } catch {
      return false;
    }
  }
}
