/**
 * ROK-1573 — the LFG primaries must carry exactly one background: the emerald
 * fill. A neutral `bg-surface` beside it wins in the stylesheet and turns the
 * button white-on-white in the light schemes.
 */
import { describe, expect, it } from 'vitest';
import {
    LFG_CONFIRM_PRIMARY_BTN,
    LFG_HERO_PRIMARY_BTN,
} from './lfg-action-buttons';
import { LFG_DIALOG_PRIMARY_BTN } from './lfg-dialog-recipes';

const backgrounds = (cls: string): string[] =>
    cls.split(/\s+/).filter((c) => /^bg-/.test(c));

describe('LFG primary button recipes', () => {
    it.each([
        ['hero primary', LFG_HERO_PRIMARY_BTN],
        ['confirm primary', LFG_CONFIRM_PRIMARY_BTN],
        ['dialog primary (Lock in / Start poll)', LFG_DIALOG_PRIMARY_BTN],
    ])('%s has only the emerald fill as its background', (_name, cls) => {
        expect(backgrounds(cls)).toEqual(['bg-emerald-600']);
        expect(cls).toContain('text-white');
        expect(cls).toContain('min-h-[44px]');
    });
});
