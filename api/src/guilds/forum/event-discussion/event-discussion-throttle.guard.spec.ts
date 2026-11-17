/**
 * ROK-2226 §6.1 — the event reply route carries a 10/min per-user throttle
 * (the spec's fallback: the hub forum guard would bucket by event id).
 */
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerException } from '@nestjs/throttler';
import { HUB_POST_CREATE_LIMIT } from '../../posts/hub-post-throttle.guard';
import { EventDiscussionReplyThrottleGuard } from './event-discussion-throttle.guard';
import { EventDiscussionController } from './event-discussion.controller';

/** A minimal HTTP context carrying a user and the `:id` (event) param. */
function ctxFor(userId: number, eventId: string): ExecutionContext {
  const req = { user: { id: userId }, params: { id: eventId } };
  const http = { getRequest: () => req };
  return { switchToHttp: () => http } as unknown as ExecutionContext;
}

function guardsOf(name: keyof EventDiscussionController): unknown[] {
  const fn: unknown = EventDiscussionController.prototype[name];
  if (typeof fn !== 'function') throw new Error(`no handler ${name}`);
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, fn);
  return Array.isArray(guards) ? guards : [];
}

describe('ROK-2226 EventDiscussionReplyThrottleGuard', () => {
  it('createReply carries the per-user reply throttle', () => {
    expect(guardsOf('createReply')).toEqual([
      EventDiscussionReplyThrottleGuard,
    ]);
  });

  it('the 11th reply in a minute is refused, across events', () => {
    const guard = new EventDiscussionReplyThrottleGuard();
    for (let i = 0; i < HUB_POST_CREATE_LIMIT; i += 1) {
      guard.canActivate(ctxFor(1, String(100 + i)));
    }
    expect(() => guard.canActivate(ctxFor(1, '999'))).toThrow(
      ThrottlerException,
    );
    expect(() => guard.canActivate(ctxFor(2, '999'))).not.toThrow();
  });
});
