/** ROK-1930 — Deaths widget helpers: Map deep links (D13), meter scale, row cap (Q5). */
import { describe, expect, it } from 'vitest';
import { valheimDeathPlayer } from '../../../test/mocks/valheim-deaths-handlers';
import {
    MAX_DEATH_ROWS,
    countedSinceLine,
    deathsMapHref,
    deathsShowAllHref,
    meterPct,
    visibleRows,
} from './valheim-deaths.helpers';

describe('deathsMapHref', () => {
    it('opens the character on the Map tab with only death pins, keeping the hash', () => {
        expect(deathsMapHref({ characterId: 42 })).toBe('?pins=death&vc=42#map');
    });

    it('is null when the bar has no character (not a link)', () => {
        expect(deathsMapHref({ characterId: null })).toBeNull();
    });
});

describe('deathsShowAllHref', () => {
    it('is the server-wide death layer, with no character', () => {
        expect(deathsShowAllHref()).toBe('?pins=death&players=all#map');
    });
});

describe('meterPct', () => {
    it('scales to the top player', () => {
        expect(meterPct(12, 12)).toBe(100);
        expect(meterPct(3, 12)).toBe(25);
    });

    it('clamps above the max and is 0 for a zero max', () => {
        expect(meterPct(20, 10)).toBe(100);
        expect(meterPct(5, 0)).toBe(0);
    });
});

describe('visibleRows', () => {
    it('keeps the first 8 rows in served order', () => {
        const players = Array.from({ length: 11 }, (_, i) => valheimDeathPlayer({ name: `P${i}`, deaths: 20 - i }));
        const rows = visibleRows(players);
        expect(MAX_DEATH_ROWS).toBe(8);
        expect(rows.map((r) => r.name)).toEqual(['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
    });
});

describe('countedSinceLine', () => {
    it('formats the date in the viewer timezone', () => {
        // 02:00Z on 1 Oct is still 30 Sep in Los Angeles.
        expect(countedSinceLine('2026-10-01T02:00:00.000Z', 'America/Los_Angeles')).toMatch(/^Counted since .*30.*Sep.*2026|^Counted since Sep 30, 2026$/);
        expect(countedSinceLine('2026-10-01T02:00:00.000Z', 'UTC')).toMatch(/Oct/);
        expect(countedSinceLine('2026-10-01T02:00:00.000Z', 'UTC')).not.toMatch(/30/);
    });

    it('is null when no death is recorded', () => {
        expect(countedSinceLine(null, 'UTC')).toBeNull();
    });
});
