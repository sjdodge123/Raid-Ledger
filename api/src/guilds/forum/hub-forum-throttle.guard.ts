import { Injectable } from '@nestjs/common';
import { PerUserThrottleGuard } from '../../common/throttle/per-user-throttle.guard';
import {
  HUB_POST_CREATE_LIMIT,
  HUB_POST_CREATE_WINDOW_MS,
} from '../posts/hub-post-throttle.guard';

/** The `:id` route param (the hub) off a request, or null when absent. */
function requestHubId(req: unknown): string | null {
  if (typeof req !== 'object' || req === null || !('params' in req))
    return null;
  const params = req.params;
  if (typeof params !== 'object' || params === null || !('id' in params)) {
    return null;
  }
  return typeof params.id === 'string' ? params.id : null;
}

/**
 * ROK-1175 Q10 — 10 forum creates (threads and replies alike) per user per
 * minute PER HUB, the hub-post values. Buckets are keyed on user + the
 * route's hub id, so one hub never spends another's quota. Its own class, so
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
