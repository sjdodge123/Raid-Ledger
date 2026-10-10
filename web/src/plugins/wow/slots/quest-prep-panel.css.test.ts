/**
 * ROK-1758: layout rules jsdom can't measure — read the stylesheet itself.
 * The coverage row must wrap on a phone (the "via addon · <date>" line was
 * clipped), and the Wowhead "↗" link needs a 44x28 hit area (design-system §tap targets)
 * that neither covers the card's expand header nor gets clipped by the card's overflow.
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

    it('gives the Wowhead link a hit area of at least 44x28 that the card edge cannot clip', () => {
        // The event card is `overflow: hidden`: anything reaching past its padding is cut off
        // (fleet verify, ROK-1758 step 9: a 24px ::before overhang was clipped to ~10px).
        const icon = rule('.quest-card__wowhead-icon');
        const before = /(?:^|\n)\.quest-card__wowhead-icon::before\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
        const cardPadding = remPx(at(/padding:\s*([\d.]+)rem/.exec(rule('.quest-card')) ?? [], 1));
        const pad = box(icon, 'padding');
        const margin = box(icon, 'margin');
        const ext = (side: Side) => Math.max(0, -Number(new RegExp(`${side}:\\s*(-?\\d+)px`).exec(before)?.[1] ?? 0));
        // How far the tappable box reaches beyond the link's own layout slot, per side.
        const reach = (side: Side) => -margin[side] + ext(side);
        expect(reach('right'), `hit area reaches ${reach('right')}px right; the card clips past ${cardPadding}px`)
            .toBeLessThanOrEqual(cardPadding);
        expect(reach('left'), 'must stay inside the 0.5rem gap, never over the card header').toBeLessThanOrEqual(8);
        const glyph = 12;
        const width = glyph + pad.left + pad.right + ext('left') + ext('right');
        const height = glyph + pad.top + pad.bottom + ext('top') + ext('bottom');
        expect(width, 'tap target width').toBeGreaterThanOrEqual(44);
        expect(height, 'tap target height').toBeGreaterThanOrEqual(28);
    });
});

type Side = 'top' | 'right' | 'bottom' | 'left';

function remPx(value: string): number {
    return Number(value) * 16;
}

/** px values of a `padding`/`margin` shorthand (1–4 values; absent → 0). */
function box(decls: string, prop: 'padding' | 'margin'): Record<Side, number> {
    const raw = new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`).exec(decls)?.[1] ?? '0';
    const v = raw.trim().split(/\s+/).map((t) => Number.parseFloat(t) || 0);
    const [top = 0, right = top, bottom = top, left = right] = v;
    return { top, right, bottom, left };
}
