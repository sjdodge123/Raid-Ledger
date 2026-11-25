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

/** ROK-2337 — channel id → its one in-flight `createWebhook` call. */
export type PendingWebhookCreates = Map<string, Promise<{ id: string }>>;

/**
 * Reuse the channel's pending create, else start one. The entry is dropped
 * only when Discord answers (success or failure), never on a caller's timeout.
 */
function startOrJoin(
  inflight: PendingWebhookCreates,
  channelId: string,
  create: () => Promise<{ id: string }>,
): Promise<{ id: string }> {
  const existing = inflight.get(channelId);
  if (existing) return existing;
  const pending = create();
  inflight.set(channelId, pending);
  const clear = (): void => {
    if (inflight.get(channelId) === pending) inflight.delete(channelId);
  };
  pending.then(clear, clear);
  return pending;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * ROK-2337 — run `create` with a time bound; a timeout throws a 503 the bind
 * surfaces. A webhook that lands after the timeout is only LOGGED, never
 * deleted and never waited on: the next `ensureWebhook` reuses a bot-owned
 * "Raid Ledger" hook (ROK-2296), and the last-unbind sweep removes the rest.
 * A retry while the channel's create is still queued joins that same promise
 * (`inflight`) with its own bound, so retries never stack extra POSTs.
 */
export async function createWebhookBounded(
  inflight: PendingWebhookCreates,
  channelId: string,
  create: () => Promise<{ id: string }>,
  rest: REST | null,
  logger: Logger,
): Promise<string> {
  const pending = startOrJoin(inflight, channelId, create);
  const unwatch = watchRateLimits(rest, channelId, logger);
  try {
    const hook = await raceTimeout(pending, FORUM_WEBHOOK_CREATE_TIMEOUT_MS);
    if (hook) return hook.id;
  } finally {
    unwatch();
  }
  void pending.then(
    (late) =>
      logger.warn(
        `Late webhook ${late.id} on ${channelId} landed after the bind gave up; left for reuse`,
      ),
    (err: unknown) =>
      logger.warn(
        `Late createWebhook on ${channelId} failed: ${describe(err)}`,
      ),
  );
  logger.warn(
    `createWebhook on ${channelId} exceeded ${FORUM_WEBHOOK_CREATE_TIMEOUT_MS}ms`,
  );
  throw new ServiceUnavailableException(
    'Discord is slow to create the forum webhook right now. Try again in a minute.',
  );
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
