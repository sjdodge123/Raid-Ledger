/** ROK-1893 P3 — helpers for the hub block on a hub-tagged poll page. */
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';

export type Voter = SchedulePollPageResponseDto['slots'][number]['votes'][number];

/** Every distinct yes-voter across the poll's times, first-seen order. */
export function uniqueVoters(slots: SchedulePollPageResponseDto['slots']): Voter[] {
    const seen = new Map<number, Voter>();
    for (const slot of slots) for (const v of slot.votes) if (!seen.has(v.userId)) seen.set(v.userId, v);
    return [...seen.values()];
}
