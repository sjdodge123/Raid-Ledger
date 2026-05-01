/**
 * Single source of truth for every BullMQ queue registered in this app.
 *
 * Used by integration tests (`truncateAllTables`) to obliterate per-suite
 * Redis state without per-call enumeration drift. When a new queue is
 * introduced, append its name constant here so test cleanup picks it up.
 *
 * Reconciliation (ROK-1058): names cross-reference 12 unique
 * `BullModule.registerQueue(...)` callsites across api/src as of
 * 2026-04-30. If a future PR adds a queue but forgets to update this list,
 * test cleanup misses it and cross-suite state can leak — over-listing is
 * cheap (obliterate on an unregistered queue is a no-op for tests because
 * the DI lookup is wrapped in a guard).
 */
import { LINEUP_PHASE_QUEUE } from '../lineups/queue/lineup-phase.constants';
import { STEAM_SYNC_QUEUE } from '../steam/steam-sync.constants';
import { ENRICHMENT_QUEUE } from '../enrichments/enrichments.constants';
import { EMBED_SYNC_QUEUE } from '../discord-bot/queues/embed-sync.queue';
import { AD_HOC_GRACE_QUEUE } from '../discord-bot/queues/ad-hoc-grace-period.queue';
import { DEPARTURE_GRACE_QUEUE } from '../discord-bot/queues/departure-grace.queue';
import { EVENT_LIFECYCLE_QUEUE } from '../discord-bot/queues/event-lifecycle.queue';
import { IGDB_SYNC_QUEUE } from '../igdb/igdb-sync.constants';
import { GAME_TASTE_RECOMPUTE_QUEUE } from '../game-taste/game-taste.constants';
import { BENCH_PROMOTION_QUEUE } from '../events/bench-promotion.service';
import { EVENT_PLANS_QUEUE } from '../events/event-plans.service';
import { DISCORD_NOTIFICATION_QUEUE } from '../notifications/discord-notification.constants';

export const ALL_QUEUE_NAMES = [
  LINEUP_PHASE_QUEUE,
  STEAM_SYNC_QUEUE,
  ENRICHMENT_QUEUE,
  EMBED_SYNC_QUEUE,
  AD_HOC_GRACE_QUEUE,
  DEPARTURE_GRACE_QUEUE,
  EVENT_LIFECYCLE_QUEUE,
  IGDB_SYNC_QUEUE,
  GAME_TASTE_RECOMPUTE_QUEUE,
  BENCH_PROMOTION_QUEUE,
  EVENT_PLANS_QUEUE,
  DISCORD_NOTIFICATION_QUEUE,
] as const;

export type RegisteredQueueName = (typeof ALL_QUEUE_NAMES)[number];
