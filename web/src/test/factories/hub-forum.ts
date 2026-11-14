/** ROK-1175 — hub forum fixtures. */
import type { HubForumThreadSummary } from '@raid-ledger/contract';

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
