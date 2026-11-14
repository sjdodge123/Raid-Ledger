/** ROK-1175 — hub forum fixtures. */
import type { HubForumCan, HubForumReply, HubForumThread, HubForumThreadSummary } from '@raid-ledger/contract';

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
