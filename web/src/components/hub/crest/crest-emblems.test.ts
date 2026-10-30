import { describe, expect, it } from 'vitest';
import { GUILD_CREST_EMBLEM_IDS } from '@raid-ledger/contract';
import { CREST_EMBLEMS } from './crest-emblems';

/** The old one-shield placeholder every id drew before the real art landed. */
const PLACEHOLDER_PATH = 'M32 10l18 6v13c0 12-7.5 19.5-18 22.5C21.5 48.5 14 41 14 29V16z';

describe('CREST_EMBLEMS', () => {
    it.each(GUILD_CREST_EMBLEM_IDS)('%s has game-icons.net art (512 viewBox, one real path)', (id) => {
        const art = CREST_EMBLEMS[id];
        expect(art.viewBox).toBe('0 0 512 512');
        expect(art.paths).toHaveLength(1);
        expect(art.paths[0]).not.toBe(PLACEHOLDER_PATH);
        expect(art.paths[0]).toMatch(/^M[\d.\s-]/);
    });

    it('draws a distinct glyph for every emblem id', () => {
        const unique = new Set(GUILD_CREST_EMBLEM_IDS.map((id) => CREST_EMBLEMS[id].paths[0]));
        expect(unique.size).toBe(GUILD_CREST_EMBLEM_IDS.length);
    });

    it('never ships the full-canvas background square game-icons.net SVGs carry', () => {
        for (const id of GUILD_CREST_EMBLEM_IDS) {
            expect(CREST_EMBLEMS[id].paths).not.toContain('M0 0h512v512H0z');
        }
    });
});
