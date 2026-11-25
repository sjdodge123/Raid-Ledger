import { ServiceUnavailableException, type Logger } from '@nestjs/common';
import { RESTEvents, type RateLimitData, type REST } from 'discord.js';

/**
 * ROK-2337 — the longest a bind waits for Discord to create the forum's
 * webhook. discord.js bounds each HTTP attempt at 15s, but NOT the time a
 * request sits in its rate-limit queue, so a throttled `createWebhook` could
 * hold the bind (and its per-guild lock) indefinitely. 30s leaves room for
 * one full attempt plus a short rate-limit wait.
 */
export const FORUM_WEBHOOK_CREATE_TIMEOUT_MS = 30_000;

/** The slice of a discord.js `Webhook` the late cleanup needs. */
export interface CreatedWebhook {
  id: string;
  delete(reason?: string): Promise<unknown>;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * ROK-2337 — bounds `createWebhook` and deletes a webhook that lands after
 * the bind gave up, unless a later `ensureWebhook` on the same channel is
 * running or already adopted it (the ROK-2296 reuse path picks up any
 * bot-owned "Raid Ledger" hook). A cleanup in progress is awaited by the
 * next `ensureWebhook` so it never lists a hook that is being deleted.
 */
export class ForumWebhookCreateGuard {
  private readonly inFlight = new Map<string, number>();
  private readonly adopted = new Map<string, string>();
  private readonly cleanups = new Map<string, Promise<void>>();

  constructor(private readonly logger: Logger) {}

  /** Wrap one `ensureWebhook` run on `channelId`. */
  async run(channelId: string, work: () => Promise<string>): Promise<string> {
    await this.cleanups.get(channelId);
    this.bump(channelId, 1);
    try {
      const id = await work();
      this.adopted.set(channelId, id);
      return id;
    } finally {
      this.bump(channelId, -1);
    }
  }

  /** Create with a time bound; a timeout throws a 503 the bind surfaces. */
  async create(
    channelId: string,
    create: () => Promise<CreatedWebhook>,
    rest: REST | null,
    reason: string,
  ): Promise<string> {
    const pending = create();
    const unwatch = watchRateLimits(rest, channelId, this.logger);
    try {
      const hook = await raceTimeout(pending, FORUM_WEBHOOK_CREATE_TIMEOUT_MS);
      if (hook) return hook.id;
    } finally {
      unwatch();
    }
    void pending.then(
      (late) => this.lateHook(channelId, late, reason),
      () => undefined, // nothing was created; nothing to clean up
    );
    this.logger.warn(
      `createWebhook on ${channelId} exceeded ${FORUM_WEBHOOK_CREATE_TIMEOUT_MS}ms`,
    );
    throw new ServiceUnavailableException(
      'Discord is slow to create the forum webhook right now. Try again in a minute.',
    );
  }

  /** A webhook that arrived after its bind timed out. Never throws. */
  private lateHook(channelId: string, hook: CreatedWebhook, reason: string) {
    const busy = (this.inFlight.get(channelId) ?? 0) > 0;
    if (busy || this.adopted.get(channelId) === hook.id) {
      this.logger.warn(`Late webhook ${hook.id} on ${channelId} kept (reused)`);
      return;
    }
    const job = hook.delete(reason).then(
      () => this.logger.warn(`Deleted late webhook ${hook.id} on ${channelId}`),
      (err: unknown) =>
        this.logger.warn(
          `Could not delete late webhook ${hook.id}: ${describe(err)}`,
        ),
    );
    this.cleanups.set(channelId, job);
    void job.finally(() => {
      if (this.cleanups.get(channelId) === job) this.cleanups.delete(channelId);
    });
  }

  private bump(channelId: string, by: number): void {
    const next = (this.inFlight.get(channelId) ?? 0) + by;
    if (next > 0) this.inFlight.set(channelId, next);
    else this.inFlight.delete(channelId);
  }
}

/** Resolves with the value, or null once `ms` passes first. */
async function raceTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Log discord.js rate-limit hits on this channel's webhook route. */
function watchRateLimits(
  rest: REST | null,
  channelId: string,
  logger: Logger,
): () => void {
  if (!rest) return () => undefined;
  const onLimit = (info: RateLimitData) => {
    if (info.majorParameter !== channelId) return;
    if (!info.route.includes('webhooks')) return;
    logger.warn(
      `createWebhook on ${channelId} rate-limited: retry in ${info.retryAfter}ms (${info.scope})`,
    );
  };
  rest.on(RESTEvents.RateLimited, onLimit);
  return () => {
    rest.off(RESTEvents.RateLimited, onLimit);
  };
}
