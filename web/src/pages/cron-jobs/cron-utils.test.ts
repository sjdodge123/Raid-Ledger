import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEME_COLORS } from './cron-utils';
import { lightSchemes, parseSchemeGroup } from '../../styles/light-scheme-css';
import { stripComments } from '../../styles/wcag-contrast';
import { at } from '../../test/defined';

const css = stripComments(readFileSync(resolve(__dirname, '../../index.css'), 'utf-8'));
const LIGHT = lightSchemes(css).map((s) => s.name).sort();

/** Every `.class` selector in a rule scoped to exactly the light scheme set, as written in markup. */
function lightScopedClasses(): Set<string> {
    const found = new Set<string>();
    for (const match of css.matchAll(/:is\(([^()]*)\)\s+\.([^\s{:]+)\s*\{/g)) {
        const names = parseSchemeGroup(at(match, 1))?.sort();
        if (names && names.join() === LIGHT.join()) found.add(at(match, 2).replace(/\\\//g, '/'));
    }
    return found;
}

const LIGHT_CLASSES = lightScopedClasses();

/**
 * The "Other" chip's neutral fill and border stay raw on purpose: a gray-100 light wash is a
 * ~1.01 step off the light and holy panels (the chip would lose its fill), while the raw
 * gray-500 at 15% / 30% already steps ~1.17-1.20 off every light panel.
 */
const ALLOWED_RAW_NEUTRAL = ['bg-gray-500/15', 'border-gray-500/30'];

const CATEGORIES = Object.entries(THEME_COLORS);

describe('cron job category chips on the light schemes', () => {
    it('reads the light block and every category', () => {
        expect(LIGHT).toEqual(['celestial', 'dawn', 'holy', 'light', 'quest-log', 'sky']);
        expect(LIGHT_CLASSES.size, 'no light-scoped class rules parsed out of index.css').toBeGreaterThan(0);
        expect(Object.keys(THEME_COLORS).length).toBeGreaterThanOrEqual(7);
    });

    it.each(CATEGORIES)('the %s chip has a light rule for every raw-hue class', (category, classes) => {
        const unrepainted = classes
            .split(/\s+/)
            .filter((cls) => !LIGHT_CLASSES.has(cls) && !ALLOWED_RAW_NEUTRAL.includes(cls));
        expect(
            unrepainted,
            `${category} chip classes with NO light rule in index.css — they paint the dark-first hue on a light panel`,
        ).toEqual([]);
    });

    it.each(ALLOWED_RAW_NEUTRAL)('%s is still used by a chip and still deliberately raw', (cls) => {
        expect(CATEGORIES.some(([, classes]) => classes.split(/\s+/).includes(cls)), `${cls} is no longer used`).toBe(true);
        expect(LIGHT_CLASSES.has(cls), `${cls} now has a light rule — drop it from ALLOWED_RAW_NEUTRAL`).toBe(false);
    });
});
