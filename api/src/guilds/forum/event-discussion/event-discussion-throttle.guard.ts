import { Injectable } from '@nestjs/common';
import { PerUserThrottleGuard } from '../../../common/throttle/per-user-throttle.guard';
import {
  HUB_POST_CREATE_LIMIT,
  HUB_POST_CREATE_WINDOW_MS,
} from '../../posts/hub-post-throttle.guard';

/**
 * ROK-2226 §6.1 — `POST events/:id/discussion/replies` allows 10 replies per
 * user per minute (the forum's create values). `HubForumThrottleGuard` keys
 * on the `:id` param, which on this route is the EVENT id, not the hub, so
 * this route uses the spec's fallback instead: one bucket per user (the base
 * class default). Its own class, so its buckets never share the hub forum's.
 */
@Injectable()
export class EventDiscussionReplyThrottleGuard extends PerUserThrottleGuard {
  protected readonly limit = HUB_POST_CREATE_LIMIT;
  protected readonly windowMs = HUB_POST_CREATE_WINDOW_MS;
}
