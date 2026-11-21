/**
 * ROK-2272 S9 — a vote / suggestion / retract on a scheduling poll marks that
 * poll's Discussion card stale (its `can.reply` follows the vote), and only
 * that poll's — other polls and lineups keep their cache.
 */
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidatePollViews } from './use-scheduling';
import { invalidateAllSubjectDiscussions, invalidateSubjectDiscussion } from './subject-discussion-key';

const POLL_31 = ['subject-discussion', 'poll', 31, 'u1'];
const POLL_32 = ['subject-discussion', 'poll', 32, 'u1'];
const LINEUP_9 = ['subject-discussion', 'lineup', 9, 'u1'];
const EVENT_5 = ['events', 5, 'discussion', 'u1'];

function seeded(): { qc: QueryClient; stale: (key: unknown[]) => boolean | undefined } {
    const qc = new QueryClient();
    for (const key of [POLL_31, POLL_32, LINEUP_9, EVENT_5]) qc.setQueryData(key, { state: 'none' });
    return { qc, stale: (key) => qc.getQueryState(key)?.isInvalidated };
}

describe('subject discussion invalidation (ROK-2272 S9)', () => {
    it('invalidatePollViews marks that poll’s discussion card stale, not another poll or a lineup', () => {
        const { qc, stale } = seeded();
        invalidatePollViews(qc, 4, 31);
        expect(stale(POLL_31)).toBe(true);
        expect(stale(POLL_32)).toBe(false);
        expect(stale(LINEUP_9)).toBe(false);
    });

    it('invalidateSubjectDiscussion is scoped to one subject (every viewer)', () => {
        const { qc, stale } = seeded();
        invalidateSubjectDiscussion(qc, { kind: 'lineup', id: 9 });
        expect(stale(LINEUP_9)).toBe(true);
        expect(stale(POLL_31)).toBe(false);
    });

    it('invalidateAllSubjectDiscussions marks every poll and lineup card stale, but not event cards', () => {
        const { qc, stale } = seeded();
        invalidateAllSubjectDiscussions(qc);
        expect([stale(POLL_31), stale(POLL_32), stale(LINEUP_9)]).toEqual([true, true, true]);
        expect(stale(EVENT_5)).toBe(false);
    });
});
