import { Injectable } from '@nestjs/common';
import { PerUserThrottleGuard } from '../../common/throttle/per-user-throttle.guard';
import {
  HUB_POST_CREATE_LIMIT,
  HUB_POST_CREATE_WINDOW_MS,
} from '../posts/hub-post-throttle.guard';

/**
 * The `:id` route param (the hub) off a request as a number, or null when it
 * is absent or not a plain digit string. The guard runs before `ParseIntPipe`,
 * so the raw string is normalised here: `010` and `10` are one hub (one
 * bucket), and an arbitrary string never mints a fresh bucket.
 */
function requestHubId(req: unknown): number | null {
  if (typeof req !== 'object' || req === null || !('params' in req))
    return null;
  const params = req.params;
  if (typeof params !== 'object' || params === null || !('id' in params)) {
    return null;
  }
  const raw = params.id;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * ROK-1175 Q10 — 10 forum creates (threads and replies alike) per user per
 * minute PER HUB, the hub-post values. Buckets are keyed on user + the
 * route's hub id (normalised; anything non-numeric falls back to the user
 * bucket), so one hub never spends another's quota. Its own class, so
 * its buckets are separate from the post composer's.
 */
@Injectable()
export class HubForumThrottleGuard extends PerUserThrottleGuard {
  protected readonly limit = HUB_POST_CREATE_LIMIT;
  protected readonly windowMs = HUB_POST_CREATE_WINDOW_MS;

  protected bucketKey(req: unknown, userId: number): number | string {
    const hubId = requestHubId(req);
    return hubId === null ? userId : `${userId}:${hubId}`;
  }
}
