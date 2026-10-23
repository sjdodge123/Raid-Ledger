import { describe, it, expect } from 'vitest';
import { supportsEventReportLinks } from './report-links';

describe('supportsEventReportLinks (WoW plugin)', () => {
    it('is true for every WoW-family game', () => {
        for (const slug of ['world-of-warcraft', 'world-of-warcraft-classic', 'world-of-warcraft-cataclysm-classic']) {
            expect(supportsEventReportLinks(slug), slug).toBe(true);
        }
    });

    it('is false for any other game', () => {
        for (const slug of ['valheim', 'final-fantasy-xiv-online', 'warcraft-iii']) {
            expect(supportsEventReportLinks(slug), slug).toBe(false);
        }
    });
});
