/** ROK-1928 review MINOR 18 — the four D2 status lines, verbatim. */
import { describe, it, expect } from 'vitest';
import { blizzardRosterStatusLine } from './blizzard-roster-status';

describe('blizzardRosterStatusLine', () => {
    it.each([
        ['ok', 'Roster via Blizzard'],
        ['not_found', "Blizzard didn't find this guild — showing the LedgerLink roster"],
        ['error', 'Last Blizzard sync failed — showing the last roster'],
        ['skipped_empty', 'Blizzard returned an empty roster — kept the last one'],
    ] as const)('%s → %s', (status, line) => {
        expect(blizzardRosterStatusLine({ status, syncedAt: null })).toBe(line);
    });

    it('ok with a sync time appends "synced …"', () => {
        const syncedAt = new Date(Date.now() - 60_000).toISOString();
        expect(blizzardRosterStatusLine({ status: 'ok', syncedAt })).toMatch(/^Roster via Blizzard · synced \S/);
    });

    it('no sync yet → no line', () => {
        expect(blizzardRosterStatusLine({ status: null, syncedAt: null })).toBeNull();
    });
});
