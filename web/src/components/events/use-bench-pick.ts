/**
 * ROK-2025: when locking a poll slot overflows the roster, the organizer
 * picks who goes to the bench. The latest yes-voters are marked by default.
 * While the organizer has not touched the marks they follow the live votes;
 * once touched, the marks are kept (minus anyone who stopped voting yes) and
 * never filled in automatically (D7). Submit is blocked until exactly the
 * overflow is marked. If the server refuses the pick on lock-in (the votes
 * changed meanwhile — an HTTP 400), the lock-in is retried once without it, so the server
 * benches the latest yes-voters, and the organizer is told (D6).
 */
import { useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { completeStandalonePoll } from '../../lib/api-client';
import { httpStatusOf } from '../../lib/api/api-error';
import { toast } from '../../lib/toast';
import type { FormState } from './create-event-form.types';
import { defaultBenchPick, useSchedulingOverflow, type SchedulingOverflow } from './use-scheduling-overflow';

export const BENCH_PICKER_ID = 'scheduling-bench-picker';

const FALLBACK_TOAST = "Event created, but the votes changed while you were choosing. The latest yes-voters went to the bench. You can move people on the event's roster.";

export interface BenchPick {
    overflow: SchedulingOverflow | null;
    picked: number[];
    /** How many voters must be marked — the overflow, capped at the voters (a 0-spot roster benches the organizer too). */
    need: number;
    /** picked − need; 0 when nothing overflows. */
    mismatch: number;
    /** What to send on lock-in; undefined when nothing overflows. */
    benchUserIds: number[] | undefined;
    toggle: (userId: number) => void;
}

export interface LockPoll {
    lineupId: number;
    matchId: number;
    startTime: string;
}

/** The pick state for one overflow (see the file header). */
export function useBenchPick(overflow: SchedulingOverflow | null): BenchPick {
    const [touched, setTouched] = useState<number[] | null>(null);
    const people = overflow?.people ?? [];
    const need = overflow ? Math.min(overflow.benched, people.length) : 0;
    const present = new Set(people.map((p) => p.userId));
    const fallback = defaultBenchPick(people, need);
    // Codex P2: prune a mark whose voter left the list, so it never comes back
    // (and is never sent) if they vote yes again. Skipped while no overflow is loaded.
    if (overflow && touched?.some((id) => !present.has(id))) setTouched(touched.filter((id) => present.has(id)));
    const picked = touched === null ? fallback : touched.filter((id) => present.has(id));
    const toggle = (userId: number) => setTouched((prev) => {
        const base = prev === null ? fallback : prev.filter((id) => present.has(id));
        return base.includes(userId) ? base.filter((id) => id !== userId) : [...base, userId];
    });
    const mismatch = overflow ? picked.length - need : 0;
    return { overflow, picked, need, mismatch, benchUserIds: overflow ? picked : undefined, toggle };
}

/** The create form's live overflow plus its bench pick; `poll` is null outside a lock-in. */
export function useLockBenchPick(poll: LockPoll | null, form: Pick<FormState, 'slotType' | 'slotPlayer' | 'maxAttendees'>): BenchPick {
    const overflow = useSchedulingOverflow({
        lineupId: poll?.lineupId, matchId: poll?.matchId, startTime: poll?.startTime,
        slotType: form.slotType, slotPlayer: form.slotPlayer, maxAttendees: form.maxAttendees,
    });
    return useBenchPick(overflow);
}

/** Inline copy for a pick of the wrong size; undefined when it is right. */
export function benchPickError(mismatch: number, need: number): string | undefined {
    if (mismatch < 0) return `Pick ${-mismatch} more for the bench.`;
    if (mismatch > 0) return `Only ${need} can go to the bench. Unmark ${mismatch}.`;
    return undefined;
}

/** True (and the picker scrolled into view) when the pick blocks the submit. */
export function guardBenchPick(bench: BenchPick): boolean {
    if (benchPickError(bench.mismatch, bench.need) === undefined) return false;
    document.getElementById(BENCH_PICKER_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
}

/** Completes the lock-in with the pick; on a 400 refusal retries once without it (D6). Any other failure rethrows untouched. */
export async function completeLockIn(matchId: number, eventId: number | undefined, startTime: string | undefined, benchUserIds: number[] | undefined): Promise<void> {
    if (eventId === undefined || benchUserIds === undefined) return completeStandalonePoll(matchId, eventId, startTime);
    try {
        await completeStandalonePoll(matchId, eventId, startTime, benchUserIds);
    } catch (error) {
        if (httpStatusOf(error) !== 400) throw error;
        await completeStandalonePoll(matchId, eventId, startTime);
        toast.warning(FALLBACK_TOAST);
    }
}

/** ROK-2031: `complete` signs the slot's voters up after the event page has loaded — refetch that event's queries (roster, signups) once it resolves. */
export function refreshLockedInEvent(qc: QueryClient, eventId: number | undefined): void {
    if (eventId !== undefined) void qc.invalidateQueries({ queryKey: ['events', eventId] });
}
