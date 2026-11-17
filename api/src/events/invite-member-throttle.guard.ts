import { Injectable } from '@nestjs/common';
import { PerUserThrottleGuard } from '../common/throttle/per-user-throttle.guard';

/** Member invites allowed per user per window (ROK-2217). */
export const INVITE_MEMBER_LIMIT = 10;
/** The member-invite window — one minute. */
export const INVITE_MEMBER_WINDOW_MS = 60_000;

/**
 * ROK-2217 — `POST /events/:id/invite-member` allows 10 invites per user per
 * minute, across events. Each invite is a Discord DM, so a signed-up member
 * must not be able to fan out a burst of them. Per user, not per IP (behind
 * the proxy every user shares an IP). Its own class, so its buckets are its
 * own. Every request counts, refused ones included.
 */
@Injectable()
export class InviteMemberThrottleGuard extends PerUserThrottleGuard {
  protected readonly limit = INVITE_MEMBER_LIMIT;
  protected readonly windowMs = INVITE_MEMBER_WINDOW_MS;
}
