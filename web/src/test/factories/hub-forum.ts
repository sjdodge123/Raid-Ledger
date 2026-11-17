/** ROK-1175 — hub forum fixtures. */
import type {
    EventDiscussionReady, HubForumCan, HubForumLock, HubForumReply, HubForumThread, HubForumThreadEvent, HubForumThreadSummary,
} from '@raid-ledger/contract';

/** A live, unpinned thread on guild 7 by user 1, active two hours before `2026-11-14T12:00Z`. */
export function buildForumThread(overrides: Partial<HubForumThreadSummary> = {}): HubForumThreadSummary {
    return {
        id: 1,
        title: 'Raid comp for Tuesday',
        preview: 'Two healers short, who can swap?',
        author: { userId: 1, displayName: 'Grimtusk', avatarUrl: null },
        createdAt: '2026-11-14T08:00:00.000Z',
        lastActivityAt: '2026-11-14T10:00:00.000Z',
        replyCount: 2,
        pinnedAt: null,
        deleted: null,
        ...overrides,
    };
}

const CAN_NONE: HubForumCan = { edit: false, delete: false, pin: false };

/** A live reply by user 2, no actions for the viewer unless `can` says so. */
export function buildForumReply(overrides: Partial<HubForumReply> = {}): HubForumReply {
    return {
        id: 11,
        body: 'I can swap to resto.',
        author: { userId: 2, displayName: 'Mossbeard', avatarUrl: null },
        createdAt: '2026-11-14T09:00:00.000Z',
        editedAt: null,
        deleted: null,
        can: CAN_NONE,
        ...overrides,
    };
}

/** The `?thread=` payload: `buildForumThread` + body, `can`, replies, reply cursor. */
export function buildForumThreadDetail(overrides: Partial<HubForumThread> = {}): HubForumThread {
    return {
        ...buildForumThread({ id: 5 }),
        body: 'Two healers short, who can swap?',
        editedAt: null,
        can: CAN_NONE,
        replies: [buildForumReply()],
        nextReplyCursor: null,
        ...overrides,
    };
}

/** ROK-2226 — the event an event thread discusses: Sun 22 Nov 2026, 19:00–22:00Z, not cancelled. */
export function buildForumThreadEvent(overrides: Partial<HubForumThreadEvent> = {}): HubForumThreadEvent {
    return {
        id: 42,
        title: 'Molten Core',
        startTime: '2026-11-22T19:00:00.000Z',
        endTime: '2026-11-22T22:00:00.000Z',
        cancelled: false,
        ...overrides,
    };
}

/** ROK-2226 — a read-only event thread's lock (closed 24 h after the event ended). */
export function buildForumLock(overrides: Partial<HubForumLock> = {}): HubForumLock {
    return { at: '2026-11-23T22:00:00.000Z', reason: 'event-ended', ...overrides };
}

/** ROK-2226 — `GET /events/:id/discussion` for a signed-up viewer: thread 5 on guild 7, one reply, writable. */
export function buildEventDiscussion(overrides: Partial<EventDiscussionReady> = {}): EventDiscussionReady {
    return {
        state: 'ready',
        guildId: 7,
        threadId: 5,
        replyCount: 1,
        latestReplies: [buildForumReply()],
        lock: null,
        can: { read: true, reply: true },
        ...overrides,
    };
}
