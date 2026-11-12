/** ROK-2187 — every send-now outcome gets its own plain-English toast. */
import { describe, expect, it } from 'vitest';
import { ggSendNowToast } from './gg-send-now-outcome';

const CLICKED = new Date('2026-12-20T18:00:00Z');
const FRESH = '2026-12-20T18:00:01Z';
const OLD = '2026-12-19T09:00:00Z';

describe('ggSendNowToast (ROK-2187)', () => {
    it.each([
        [{ status: 'announced', year: 2026, announcedAt: FRESH }, 'success', /GG 2026 announced/],
        [{ status: 'waiting-offset', year: 2026, announcedAt: FRESH }, 'success', /GG 2026 announced/],
        [{ status: 'announced', year: 2026, announcedAt: OLD }, 'info', /already announced/i],
        [{ status: 'waiting-offset', year: 2026, announcedAt: OLD }, 'info', /already announced/i],
        [{ status: 'disabled' }, 'error', /delivery is turned off/i],
        [{ status: 'not-connected' }, 'error', /bot isn't connected/i],
        [{ status: 'no-channel' }, 'error', /no announcement channel/i],
        [{ status: 'busy' }, 'error', /already running/i],
    ] as const)('%o → %s', (outcome, kind, text) => {
        const t = ggSendNowToast(outcome, CLICKED);
        expect(t.kind).toBe(kind);
        expect(t.text).toMatch(text);
    });

    it('never answers an unknown status with success', () => {
        expect(ggSendNowToast({ status: 'not-due' }, CLICKED).kind).toBe('error');
        expect(ggSendNowToast({ status: 'something-new' }, CLICKED).kind).toBe('error');
    });
});
