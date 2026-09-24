/**
 * The light-scheme `.bg-panel` shadow must live in `@layer components`.
 * Unlayered, its `box-shadow` beats every Tailwind v4 utility (which sit in
 * `@layer utilities`), so `focus-visible:ring-*` never painted on a bg-panel
 * field in the six light schemes (found by the ROK-1649 fleet UI verification).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Name of the innermost `@layer <name>` block enclosing `at`, or null when unlayered. */
function enclosingLayer(at: number): string | null {
    let depth = 0;
    for (let i = at; i >= 0; i -= 1) {
        if (css[i] === '}') depth += 1;
        else if (css[i] === '{') {
            if (depth === 0) {
                const head = css.slice(css.lastIndexOf('\n', i - 1) + 1, i).trim();
                const m = /^@layer\s+([\w-]+)$/.exec(head);
                if (m) return m[1];
            } else depth -= 1;
        }
    }
    return null;
}

describe('light-scheme panel shadow (index.css)', () => {
    it('sits inside @layer components so focus rings and shadow utilities win', () => {
        const at = css.indexOf('[data-scheme="celestial"]) .bg-panel,');
        expect(at).toBeGreaterThan(-1);
        expect(enclosingLayer(at)).toBe('components');
    });
});
