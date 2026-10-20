import { Injectable } from '@nestjs/common';
import { PerUserThrottleGuard } from '../../common/throttle/per-user-throttle.guard';

/**
 * Hub-post creates allowed per user per window. Not lifted by
 * THROTTLE_DISABLED — the route's limit was always enforced, and the
 * integration spec proves it.
 */
export const HUB_POST_CREATE_LIMIT = 10;
/** The hub-post create window — one minute. */
export const HUB_POST_CREATE_WINDOW_MS = 60_000;

/**
 * ROK-1868 — 10 creates/min per user on `POST /guilds/:id/posts`. Per user,
 * not per IP: behind the proxy every editor shares an IP, so the global
 * throttler would let one editor's burst block the rest.
 */
@Injectable()
export class HubPostThrottleGuard extends PerUserThrottleGuard {
  protected readonly limit = HUB_POST_CREATE_LIMIT;
  protected readonly windowMs = HUB_POST_CREATE_WINDOW_MS;
}
