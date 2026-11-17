/**
 * Event discussion shapes (ROK-2226): the event-page card response, the
 * event chip and lock on a thread summary, and `canReply` on a thread.
 */
import { describe, expect, it } from 'vitest';
import {
  EVENT_DISCUSSION_LATEST_MAX,
  EventDiscussionSchema,
  type EventDiscussionReady,
} from '../event-discussion.schema.js';
import {
  HUB_FORUM_LOCK_REASONS,
  HubForumLockSchema,
  HubForumThreadEventSchema,
  HubForumThreadSchema,
  HubForumThreadSummarySchema,
  type HubForumReply,
  type HubForumThreadSummary,
} from '../hub-forum.schema.js';

const at = '2026-11-16T20:00:00.000Z';
const can = { edit: false, delete: false, pin: false };
const reply = (n: number): HubForumReply => ({
  id: n,
  body: `reply ${n}`,
  author: { userId: 7, displayName: 'Ana', avatarUrl: null },
  createdAt: at,
  editedAt: null,
  deleted: null,
  can,
});
const ready: EventDiscussionReady = {
  state: 'ready',
  guildId: 4,
  threadId: 11,
  replyCount: 5,
  latestReplies: [reply(1), reply(2), reply(3)],
  lock: null,
  can: { read: true, reply: true },
};
const event = { id: 42, title: 'Molten Core', startTime: at, endTime: at, cancelled: false };
const summary: HubForumThreadSummary = {
  id: 11,
  title: 'Molten Core',
  preview: 'Discussion for Molten Core.',
  author: null,
  createdAt: at,
  lastActivityAt: at,
  replyCount: 0,
  pinnedAt: null,
  deleted: null,
};

describe('EventDiscussionSchema', () => {
  it('accepts the none state and nothing else alongside it', () => {
    expect(EventDiscussionSchema.safeParse({ state: 'none' }).success).toBe(true);
    expect(EventDiscussionSchema.safeParse({ state: 'none', threadId: 1 }).success).toBe(false);
  });

  it('accepts a ready card with up to three replies and a lock', () => {
    expect(EventDiscussionSchema.safeParse(ready).success).toBe(true);
    const locked = { ...ready, lock: { at, reason: 'event-ended' }, can: { read: true, reply: false } };
    expect(EventDiscussionSchema.safeParse(locked).success).toBe(true);
  });

  it(`refuses more than ${EVENT_DISCUSSION_LATEST_MAX} latest replies`, () => {
    const four = { ...ready, latestReplies: [reply(1), reply(2), reply(3), reply(4)] };
    expect(EventDiscussionSchema.safeParse(four).success).toBe(false);
  });

  it('never carries reply text to a viewer who cannot read (ruling 16)', () => {
    const leak = { ...ready, can: { read: false, reply: false } };
    const result = EventDiscussionSchema.safeParse(leak);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['latestReplies']);
    const countOnly = { ...leak, latestReplies: [] };
    expect(EventDiscussionSchema.safeParse(countOnly).success).toBe(true);
  });

  it('refuses unknown states and extra keys', () => {
    expect(EventDiscussionSchema.safeParse({ state: 'hidden' }).success).toBe(false);
    expect(EventDiscussionSchema.safeParse({ ...ready, title: 'x' }).success).toBe(false);
  });
});

describe('HubForumLockSchema', () => {
  it('takes exactly the three lock reasons', () => {
    expect(HUB_FORUM_LOCK_REASONS).toEqual(['event-ended', 'event-detached', 'event-deleted']);
    for (const reason of HUB_FORUM_LOCK_REASONS) {
      expect(HubForumLockSchema.safeParse({ at, reason }).success).toBe(true);
    }
    expect(HubForumLockSchema.safeParse({ at, reason: 'moderator' }).success).toBe(false);
  });
});

describe('thread summary event chip (additive)', () => {
  it('still accepts a normal thread without event or lock', () => {
    expect(HubForumThreadSummarySchema.safeParse(summary).success).toBe(true);
    const nulls = { ...summary, event: null, lock: null };
    expect(HubForumThreadSummarySchema.safeParse(nulls).success).toBe(true);
  });

  it('accepts an event thread with its event and lock', () => {
    const tagged = { ...summary, event, lock: { at, reason: 'event-deleted' } };
    expect(HubForumThreadSummarySchema.safeParse(tagged).success).toBe(true);
  });

  it('keeps the event chip strict', () => {
    expect(HubForumThreadEventSchema.safeParse({ ...event, guildId: 4 }).success).toBe(false);
    expect(HubForumThreadEventSchema.safeParse({ ...event, cancelled: 'no' }).success).toBe(false);
  });
});

describe('thread canReply (additive)', () => {
  const thread = { ...summary, body: 'b', editedAt: null, can, replies: [], nextReplyCursor: null };

  it('is optional and boolean', () => {
    expect(HubForumThreadSchema.safeParse(thread).success).toBe(true);
    expect(HubForumThreadSchema.safeParse({ ...thread, canReply: false }).success).toBe(true);
    expect(HubForumThreadSchema.safeParse({ ...thread, canReply: 'yes' }).success).toBe(false);
  });
});
