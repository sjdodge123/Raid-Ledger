import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AA_SMALL_TEXT, composite, contrastRatio, stripComments } from './wcag-contrast';
import { lightSchemes, lightTextRules } from './light-scheme-css';

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
 * This guard reads every light `.text-{hue}-{shade}` repaint (plus its `/NN` opacity
 * variants and `hover:` rules) out of `index.css` and measures it where it is really
 * read, on EVERY light scheme: its surface, its panel, and the hue's own `-500/10` tint
 * composited over that panel. The badge-overlay rules (dark shades kept
 * on dark game-cover art) are deliberately excluded by the selector shape.
 */

const css = stripComments(readFileSync(resolve(__dirname, '../index.css'), 'utf-8'));

/**
 * Every light scheme's own surface and panel — the shared light block is NOT enough:
 * celestial (#e4ddd0), quest-log (#f0e4c8) and dawn (#ffe8d0) panels are far darker
 * than the shared #f1f5f9, and a repaint that clears the shared panel can fail there.
 */
const SCHEMES = lightSchemes(css);

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

/** Plain, opacity-variant (`/60`) and `hover:` repaints scoped to the light scheme set. */
const RULES = lightTextRules(css, SCHEMES.map((s) => s.name));
const repaints = new Map(RULES.filter((r) => r.alpha === 1).map((r) => [r.cls, r.color]));

/**
 * Every [class, scheme · background, painted text, background hex] a repaint must clear
 * AA on: each light scheme's surface, its panel, and the hue's `-500/10` tint over that
 * panel. An rgba repaint is composited over the background first — that is what is read.
 */
const CASES = RULES.filter((r) => TINT_500[r.hue] !== undefined).flatMap((r) =>
    SCHEMES.flatMap(({ name, surface, panel }) =>
        ([
            ['--color-surface', surface],
            ['--color-panel', panel],
            [`bg-${r.hue}-500/10 over --color-panel`, composite(TINT_500[r.hue], panel, 0.1)],
        ] as const).map(([bgName, bg]) => {
            const painted = r.alpha === 1 ? r.color : composite(r.color, bg, r.alpha);
            return [r.cls, `${name} · ${bgName}`, painted, bg] as const;
        }),
    ),
);

describe('raw Tailwind accent hues on light (ROK-1586)', () => {
    it('finds every light scheme with a surface and panel', () => {
        expect(SCHEMES.map((s) => s.name).sort()).toEqual(['celestial', 'dawn', 'holy', 'light', 'quest-log', 'sky']);
        for (const s of SCHEMES) expect(s.surface && s.panel, `${s.name} has no surface/panel`).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('finds the light repaint block, its opacity variants and its hover rules', () => {
        expect(repaints.size, 'no `.text-{hue}-{shade}` light repaints were parsed out of index.css').toBeGreaterThan(0);
        expect(RULES.map((r) => r.cls)).toEqual(expect.arrayContaining(['text-red-400/60', 'text-amber-400/60', 'hover:text-red-300']));
    });

    it.each(REQUIRED)('text-%s is repainted for the light schemes', (cls) => {
        expect(
            repaints.get(`text-${cls}`),
            `text-${cls} has NO light repaint in index.css — it renders its dark-first shade on a light surface`,
        ).toBeDefined();
    });

    it.each(CASES)('light %s clears AA on %s', (cls, where, painted, bg) => {
        const ratio = contrastRatio(painted, bg);
        expect(
            ratio,
            `light ${cls} (painted ${painted}) is ${ratio}:1 on ${where} (${bg}) — needs ${AA_SMALL_TEXT}:1`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
});
