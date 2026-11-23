import { Injectable } from '@nestjs/common';
import { PerUserThrottleGuard } from '../../../common/throttle/per-user-throttle.guard';
import {
  HUB_POST_CREATE_LIMIT,
  HUB_POST_CREATE_WINDOW_MS,
} from '../../posts/hub-post-throttle.guard';

/**
 * ROK-2272 S7a — `POST scheduling-polls/:matchId/discussion/replies`: the
 * forum's create values, one bucket per user (`:matchId` is not a hub id).
 * Its own class, so its buckets never share the event or hub forum ones.
 */
@Injectable()
export class PollDiscussionReplyThrottleGuard extends PerUserThrottleGuard {
  protected readonly limit = HUB_POST_CREATE_LIMIT;
  protected readonly windowMs = HUB_POST_CREATE_WINDOW_MS;
}
