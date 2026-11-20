import { Injectable } from '@nestjs/common';
import { PerUserThrottleGuard } from '../../../common/throttle/per-user-throttle.guard';
import {
  HUB_POST_CREATE_LIMIT,
  HUB_POST_CREATE_WINDOW_MS,
} from '../../posts/hub-post-throttle.guard';

/**
 * ROK-2272 S7b — `POST lineups/:id/discussion/replies`: the forum's create
 * values, one bucket per user (`:id` is not a hub id). Its own class, so its
 * buckets never share the event, poll or hub forum ones.
 */
@Injectable()
export class LineupDiscussionReplyThrottleGuard extends PerUserThrottleGuard {
  protected readonly limit = HUB_POST_CREATE_LIMIT;
  protected readonly windowMs = HUB_POST_CREATE_WINDOW_MS;
}
