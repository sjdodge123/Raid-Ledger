/**
 * ROK-2292 review MINOR — the starter-card sync runs on every signup change,
 * and each hub starter edit needs the forum's webhook (token included). A
 * `fetchWebhooks()` per edit is a low-rate-limit GET, so a burst of signups
 * would 429. This keeps the webhook in process memory for a short TTL (never
 * persisted — OQ-9 still holds for the database) and drops it as soon as an
 * edit through it fails, so a deleted or rotated webhook is re-fetched.
 */

/** The forum + webhook a cached entry is for. */
export interface WebhookKey {
  channelId: string;
  webhookId: string;
}

/** How long a fetched webhook is reused. */
export const WEBHOOK_CACHE_TTL_MS = 10 * 60 * 1000;

function keyOf(target: WebhookKey): string {
  return `${target.channelId}:${target.webhookId}`;
}

/** A tiny TTL cache of fetched webhooks, keyed by forum + webhook id. */
export class WebhookCache<T> {
  private readonly hooks = new Map<string, { hook: T; at: number }>();

  constructor(
    private readonly ttlMs = WEBHOOK_CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** The cached webhook, or `fetch` it (and cache it) when absent/expired. */
  async get(target: WebhookKey, fetch: (t: WebhookKey) => Promise<T>) {
    const key = keyOf(target);
    const hit = this.hooks.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.hook;
    const hook = await fetch(target);
    this.hooks.set(key, { hook, at: this.now() });
    return hook;
  }

  /** Forget `target` (an edit through it failed). */
  evict(target: WebhookKey): void {
    this.hooks.delete(keyOf(target));
  }
}
