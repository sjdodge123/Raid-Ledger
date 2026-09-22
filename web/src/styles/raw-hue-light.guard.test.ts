import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AA_SMALL_TEXT, composite, contrastRatio, stripComments } from './wcag-contrast';

/**
 * Raw-hue light-contrast guard (ROK-1586 follow-up).
 *
 * The app paints chips, badges and pills with raw Tailwind accent hues
 * (`text-amber-300`, `text-red-400` …) — dark-first shades that are illegible on a
 * light surface. `index.css` repaints them for the six light schemes. Fleet plan
 * 2026-09-22-2141-6754 step 1 failed ("Amber and red are still hard to read on light")
 * because those repaints were measured against `#fff` only — the chip sits on its own
 * `/10` tint over the panel — and because `text-amber-300`, `text-red-300`,
 * `text-indigo-300` and `text-blue-400` had no repaint at all.
 *
 * This guard reads every light `.text-{hue}-{shade}` repaint out of `index.css` and
 * measures it where it is really read: the light surface, the panel, and the hue's own
 * `-500/10` tint composited over the panel. The badge-overlay rules (dark shades kept
 * on dark game-cover art) are deliberately excluded by the selector shape.
 */

const css = stripComments(readFileSync(resolve(__dirname, '../index.css'), 'utf-8'));

/** The shared light block's `--color-surface` / `--color-panel` (index.css `:is([data-scheme="light"]…)`). */
const LIGHT_SURFACE = '#ffffff';
const LIGHT_PANEL = '#f1f5f9';

/** Tailwind `-500` of each hue — what a `bg-{hue}-500/10` chip tint is mixed from. */
const TINT_500: Record<string, string> = {
    red: '#ef4444',
    amber: '#f59e0b',
    yellow: '#eab308',
    green: '#22c55e',
    emerald: '#10b981',
    purple: '#a855f7',
    indigo: '#6366f1',
    cyan: '#06b6d4',
    blue: '#3b82f6',
};

/**
 * Classes that MUST be repainted on light. The first four are the chips of the dev
 * sheet's "Semantic accents" row (`tokens-section.tsx` ACCENTS); the rest are the
 * shipped semantic shades with the most call sites.
 */
const REQUIRED = [
    'emerald-300', 'amber-300', 'red-300', 'indigo-300',
    'emerald-400', 'emerald-500', 'amber-400', 'red-400', 'yellow-400', 'yellow-500',
    'green-400', 'green-500', 'purple-400', 'indigo-400', 'cyan-300', 'cyan-400',
    'blue-300', 'blue-400',
];

/** `:is(<light schemes>) .text-{hue}-{shade} { color: #hex; }` — a plain light repaint, not a badge-overlay one. */
const REPAINT = /\[data-scheme="celestial"\]\)\s+\.text-([a-z]+)-(\d{3})\s*\{\s*color:\s*(#[0-9a-fA-F]{6})\s*;?\s*\}/g;

const repaints = new Map<string, string>(
    [...css.matchAll(REPAINT)].map((m) => [`${m[1]}-${m[2]}`, m[3].toLowerCase()]),
);

/** Every [class, background name, background hex] a repaint must clear AA on. */
const CASES = [...repaints.entries()]
    .filter(([cls]) => TINT_500[cls.split('-')[0]] !== undefined)
    .flatMap(([cls, color]) => {
        const hue = cls.split('-')[0];
        return [
            [cls, color, '--color-surface', LIGHT_SURFACE],
            [cls, color, '--color-panel', LIGHT_PANEL],
            [cls, color, `bg-${hue}-500/10 over --color-panel`, composite(TINT_500[hue], LIGHT_PANEL, 0.1)],
        ] as const;
    });

describe('raw Tailwind accent hues on light (ROK-1586)', () => {
    it('finds the light repaint block', () => {
        expect(repaints.size, 'no `.text-{hue}-{shade}` light repaints were parsed out of index.css').toBeGreaterThan(0);
    });

    it.each(REQUIRED)('text-%s is repainted for the light schemes', (cls) => {
        expect(
            repaints.get(cls),
            `text-${cls} has NO light repaint in index.css — it renders its dark-first shade on a light surface`,
        ).toBeDefined();
    });

    it.each(CASES)('light text-%s (%s) clears AA on %s', (cls, color, name, bg) => {
        const ratio = contrastRatio(color, bg);
        expect(
            ratio,
            `light text-${cls} ${color} is ${ratio}:1 on ${name} (${bg}) — needs ${AA_SMALL_TEXT}:1`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
});
