/**
 * ROK-1953 D1/D5 — the Core Steam achievements + playtime refresh.
 * Enabling another game = add its Steam app id here after an L0 fixture
 * check (its `GetSchemaForGame` must carry `hidden`, OQ5).
 */
import type { GuildKind } from '@raid-ledger/contract';

/** BullMQ queue for the nightly + on-link refresh. */
export const STEAM_APP_STATS_QUEUE = 'steam-app-stats';

/** D1: Steam app ids whose game hubs get the cards. 1086940 = Baldur's Gate 3. */
export const STEAM_STATS_APP_IDS: ReadonlySet<number> = new Set([1086940]);

/** Hub kinds that can show the cards (OQ3). */
export const STEAM_STATS_HUB_KINDS: readonly GuildKind[] = [
  'game_community',
  'game_server',
];

/** Pause between per-user Steam calls. */
export const USER_DELAY_MS = 200;

/** Hard ceiling on per-user fetches in one run (D5). */
export const MAX_USER_FETCHES_PER_RUN = 5000;

/** BullMQ retry backoff base after a 429 circuit-break (D5). */
export const RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000;

/** Job payload: the nightly run, or one user right after linking Steam (D6). */
export type SteamAppStatsJobData =
  { trigger: 'scheduled' } | { trigger: 'link'; userId: number };

/** Run limits, injectable so specs can shrink them (R6). */
export interface SteamStatsRunLimits {
  delayMs: number;
  maxUserFetches: number;
}

/** DI token for {@link SteamStatsRunLimits}. */
export const STEAM_STATS_RUN_LIMITS = Symbol('STEAM_STATS_RUN_LIMITS');

/** Thrown on the first HTTP 429 so BullMQ retries the run later (D5). */
export class SteamRateLimitedError extends Error {
  constructor(readonly appId: number) {
    super(`Steam rate-limited the stats refresh (app ${appId})`);
    this.name = 'SteamRateLimitedError';
  }
}
