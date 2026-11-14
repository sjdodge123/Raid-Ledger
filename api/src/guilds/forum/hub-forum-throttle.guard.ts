import { Injectable } from '@nestjs/common';
import { PerUserThrottleGuard } from '../../common/throttle/per-user-throttle.guard';
import {
  HUB_POST_CREATE_LIMIT,
  HUB_POST_CREATE_WINDOW_MS,
} from '../posts/hub-post-throttle.guard';

/**
 * ROK-1175 Q10 — 10 forum creates (threads and replies alike) per user per
 * minute, the hub-post values. Its own class, so its buckets are separate
 * from the post composer's.
 */
@Injectable()
export class HubForumThrottleGuard extends PerUserThrottleGuard {
  protected readonly limit = HUB_POST_CREATE_LIMIT;
  protected readonly windowMs = HUB_POST_CREATE_WINDOW_MS;
}
