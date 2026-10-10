/**
 * ROK-1758: layout rules jsdom can't measure — read the stylesheet itself.
 * The coverage row must wrap on a phone (the "via addon · <date>" line was
 * clipped), and the Wowhead "↗" link needs a 44px hit area (design-system §tap targets).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'quest-prep-panel.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the FIRST rule whose selector is exactly `selector`. */
function rule(selector: string): string {
    const match = new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(CSS);
    if (!match) throw new Error(`no rule for ${selector}`);
    return match[1];
}

describe('quest-prep-panel.css (ROK-1758)', () => {
    it('lets the coverage row wrap and shrink instead of clipping its source line', () => {
        const right = rule('.quest-card__details-right');
        expect(right, 'flex-shrink: 0 pins the row at its content width').not.toMatch(/flex-shrink:\s*0/);
        expect(right).toMatch(/flex-wrap:\s*wrap/);
        expect(rule('.quest-card__details')).toMatch(/flex-wrap:\s*wrap/);
    });

    it('gives the Wowhead link a 44x44 hit area', () => {
        const icon = rule('.quest-card__wowhead-icon');
        expect(icon).toMatch(/min-width:\s*44px/);
        expect(icon).toMatch(/min-height:\s*44px/);
        expect(icon).toMatch(/justify-content:\s*center/);
    });
});
