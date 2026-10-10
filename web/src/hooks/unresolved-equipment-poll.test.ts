/**
 * ROK-1760 review — the poll budget survives a query-cache rebuild without
 * over-polling, and the interval widens so one budget spans a full gear set.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CharacterDto } from '@raid-ledger/contract';
import {
    UNRESOLVED_POLL_MAX_TRIES,
    resetUnresolvedEquipmentPoll,
    unresolvedEquipmentInterval,
} from './unresolved-equipment-poll';

const ID = 'char-1';
const UNRESOLVED = { equipment: { items: [{ resolved: false }] } } as unknown as CharacterDto;

function query(dataUpdateCount: number) {
    return { state: { data: UNRESOLVED, dataUpdateCount, errorUpdateCount: 0 } };
}

/** Interval answers for fetch counts `from..to-1` (one call per fetch). */
function intervals(from: number, to: number): (number | false)[] {
    const out: (number | false)[] = [];
    for (let n = from; n < to; n++) out.push(unresolvedEquipmentInterval(ID, query(n)));
    return out;
}

describe('unresolvedEquipmentInterval (ROK-1760 review)', () => {
    beforeEach(() => resetUnresolvedEquipmentPoll());

    it('widens 3 s → 6 s → 12 s so one budget spans ~90 s, then stops', () => {
        expect(intervals(0, UNRESOLVED_POLL_MAX_TRIES + 1)).toEqual([
            3000, 3000, 6000, 6000, 12000, 12000, 12000, 12000, 12000, 12000, false,
        ]);
    });

    it('a rebuilt query (fetch counter back to 0) gets one budget, not budget + stale offset', () => {
        intervals(4, 8); // the episode began at fetch 4
        // TanStack GC'd the entry; the recreated query counts from 0 again.
        const afterRebuild = intervals(0, UNRESOLVED_POLL_MAX_TRIES * 2);
        expect(afterRebuild.filter((v) => v !== false)).toHaveLength(UNRESOLVED_POLL_MAX_TRIES);
    });
});
