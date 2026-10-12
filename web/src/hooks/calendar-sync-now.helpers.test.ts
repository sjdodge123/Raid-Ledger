/**
 * ROK-1595 review r2 — "Sync now" follow-through: a second click while a loop
 * is running joins it instead of starting a parallel one; once it finishes,
 * the next click starts a fresh loop.
 */
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { CalendarsOverview } from '@raid-ledger/contract';
import { server } from '../test/mocks/server';
import { createTestQueryClient } from '../test/render-helpers';
import { CALENDARS_OVERVIEW_URL, calendarsOverviewFixture, readConnectionFixture } from '../test/mocks/calendar-sync-handlers';

vi.mock('./use-auth', () => ({ getAuthToken: () => 'test-token' }));

import { CALENDARS_OVERVIEW_KEY } from './use-calendar-sync';
import { SYNC_LAND_MAX_TRIES, refreshWhenSynced } from './calendar-sync-now.helpers';

/** The sync never lands: every read returns the same `lastSyncedAt`. */
function countReads(): { reads: () => number } {
    let reads = 0;
    server.use(http.get(CALENDARS_OVERVIEW_URL, () => {
        reads += 1;
        return HttpResponse.json(calendarsOverviewFixture({ connections: [readConnectionFixture] }));
    }));
    return { reads: () => reads };
}

function setup() {
    const qc = createTestQueryClient();
    qc.setQueryData<CalendarsOverview>([...CALENDARS_OVERVIEW_KEY], calendarsOverviewFixture({ connections: [readConnectionFixture] }));
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    return { qc, invalidate };
}

describe('refreshWhenSynced — one loop per connection', () => {
    it('a second call while the first loop runs joins it: one capped loop, one refresh', async () => {
        const counter = countReads();
        const { qc, invalidate } = setup();
        const before = readConnectionFixture.lastSyncedAt;
        const first = refreshWhenSynced(qc, readConnectionFixture.id, before, 1);
        const second = refreshWhenSynced(qc, readConnectionFixture.id, before, 1);
        await Promise.all([first, second]);
        expect(counter.reads(), 'overview re-reads for two overlapping clicks').toBe(SYNC_LAND_MAX_TRIES);
        expect(invalidate.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify([...CALENDARS_OVERVIEW_KEY])),
            'the dependents refresh once, not once per click').toHaveLength(1);
    });

    it('a call after the loop finished starts a new one', async () => {
        const counter = countReads();
        const { qc } = setup();
        const before = readConnectionFixture.lastSyncedAt;
        await refreshWhenSynced(qc, readConnectionFixture.id, before, 1);
        await refreshWhenSynced(qc, readConnectionFixture.id, before, 1);
        expect(counter.reads(), 'two sequential clicks, two full loops').toBe(SYNC_LAND_MAX_TRIES * 2);
    });
});
