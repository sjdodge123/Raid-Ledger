/**
 * ROK-1758: layout rules jsdom can't measure — read the stylesheet itself.
 * The coverage row must wrap on a phone (the "via addon · <date>" line was
 * clipped), and the Wowhead "↗" link needs a 44px hit area (design-system §tap targets) —
 * a transparent ::before, so the 12px glyph keeps its layout footprint.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { at } from '../../../test/defined';

const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'quest-prep-panel.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the FIRST rule whose selector is exactly `selector`. */
function rule(selector: string): string {
    const match = new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(CSS);
    if (!match) throw new Error(`no rule for ${selector}`);
    return at(match, 1);
}

describe('quest-prep-panel.css (ROK-1758)', () => {
    it('lets the coverage row wrap and shrink instead of clipping its source line', () => {
        const right = rule('.quest-card__details-right');
        expect(right, 'flex-shrink: 0 pins the row at its content width').not.toMatch(/flex-shrink:\s*0/);
        expect(right).toMatch(/flex-wrap:\s*wrap/);
        expect(rule('.quest-card__details')).toMatch(/flex-wrap:\s*wrap/);
    });

    it('gives the Wowhead link a 44px-wide hit area that stays inside the 8px gaps around it', () => {
        expect(rule('.quest-card__wowhead-icon'), 'anchors the hit area').toMatch(/position:\s*relative/);
        const hit = rule('.quest-card__wowhead-icon::before');
        expect(hit).toMatch(/position:\s*absolute/);
        const inset = (side: string) => Number(new RegExp(`${side}:\\s*(-?\\d+)px`).exec(hit)?.[1]);
        // Left/top/bottom ≤ the 0.5rem gaps: never over the card header (left) or a neighbour row.
        expect([inset('left'), inset('top'), inset('bottom')]).toEqual([-8, -8, -8]);
        // 12px glyph + 8px left + 24px right = 44px wide.
        expect(inset('left') + inset('right')).toBe(-32);
        expect(hit, 'a 44px box centred on the glyph overhangs 16px into the header').not.toMatch(/width:\s*44px/);
    });
});
