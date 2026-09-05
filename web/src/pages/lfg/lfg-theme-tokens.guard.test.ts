/**
 * ROK-1478 operator walk — the LFG surfaces must be readable in LIGHT mode.
 *
 * The group page shipped with a dark-only palette: every heading was
 * `text-zinc-100`, chips were `bg-zinc-700`, and the panel titles were
 * therefore near-white on a white `bg-surface` under `[data-scheme="light"]`.
 *
 * This is a SOURCE-INTROSPECTION guard, not a render assertion, for the same
 * reason `game-badges.dedup-guard.test.ts` is: jsdom loads no stylesheet, so a
 * rendered test cannot see a contrast failure. What CAN be checked is the
 * property that actually caused it — a literal palette class that no theme
 * token and no light-mode override governs.
 *
 * Two families are banned:
 *
 *  1. `zinc-*` / `gray-N` — hard-coded neutrals. `index.css` remaps NOTHING in
 *     those palettes per scheme, so they render identically on every theme.
 *     The theme tokens (`text-foreground`, `text-muted`, `bg-surface`,
 *     `bg-panel`, `bg-overlay`, `bg-faint`, `border-edge`) are the only
 *     neutrals that follow `[data-scheme]`.
 *
 *  2. Accent shades with no ROK-464 light-mode override. `index.css` bumps the
 *     -300/-400 status shades to -600/-700 under the light schemes, but that
 *     block covers a FIXED list. A shade outside it (notably the amber and
 *     emerald 200/300 fills used here) keeps its pale dark-mode value on white.
 *     Note this repo has no Tailwind `dark:` variant wired to `data-scheme` —
 *     there are zero `dark:` utilities in `web/src` — so `x dark:y` pairs would
 *     silently key off `prefers-color-scheme` and ignore the user's theme. The
 *     ROK-464 override block is the mechanism; pick a shade it covers.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** `web/src`, resolved from this file's location. */
const WEB_SRC = resolve(__dirname, '../..');

/** Directories swept wholesale, plus the events banner that shares the palette. */
const SWEPT_DIRS = ['pages/lfg', 'components/lfg'];
const SWEPT_FILES = ['components/events/lfg-summary-banner.tsx'];

/**
 * Strip comments before scanning — this file documents the banned classes in
 * prose, and a naive scan would flag its own explanation (the repeat failure
 * mode recorded for the ROK-1314 guards).
 */
const codeOnly = (src: string): string =>
    src
        // Keep the newline count so reported line numbers match the real file.
        .replace(/\/\*[\s\S]*?\*\//g, (block) =>
            '\n'.repeat((block.match(/\n/g) ?? []).length),
        )
        .replace(/\/\/[^\n]*/g, '');

/** Every non-test source file in the swept set, as `[relativePath, code]`. */
function sweptSources(): [string, string][] {
    const files = SWEPT_DIRS.flatMap((dir) =>
        readdirSync(resolve(WEB_SRC, dir))
            .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
            .map((name) => `${dir}/${name}`),
    ).concat(SWEPT_FILES);
    return files.map((rel) => [
        rel,
        codeOnly(readFileSync(resolve(WEB_SRC, rel), 'utf-8')),
    ]);
}

/** `file:line — the offending text`, for every match of `pattern` not in `covered`. */
function offenders(pattern: RegExp, covered = new Set<string>()): string[] {
    const hits: string[] = [];
    for (const [rel, code] of sweptSources()) {
        code.split('\n').forEach((line, index) => {
            for (const found of line.match(pattern) ?? []) {
                if (!covered.has(found)) {
                    hits.push(`${rel}:${index + 1} — ${found}`);
                }
            }
        });
    }
    return hits;
}

/**
 * Every amber/emerald TEXT utility the ROK-464 block in `index.css` actually
 * remaps under the light schemes, transcribed from that block. Anything
 * matching the amber/emerald text shape but absent here keeps its pale
 * dark-mode value on a white surface.
 */
const LIGHT_MAPPED_TEXT = new Set([
    'text-amber-400',
    'text-amber-400/80',
    'text-amber-400/70',
    'text-amber-400/60',
    'text-amber-500/80',
    'text-emerald-300',
    'text-emerald-400',
    'text-emerald-500',
    'hover:text-amber-300',
    'hover:text-emerald-300',
]);

/**
 * `text-emerald-400`, `hover:text-amber-300`, `text-amber-400/80`, …
 *
 * Shades 100-800 only. The -900/-950 tier is near-black ink deliberately laid
 * on a SOLID accent fill (the chip's `bg-amber-300/95 text-amber-950`, the
 * overlap strip's `bg-emerald-500/80 text-emerald-950`); that pairing carries
 * its own contrast and reads the same on every scheme, so it needs no remap.
 */
const ACCENT_TEXT_RE =
    /(?:hover:)?text-(?:amber|emerald)-[1-8]00(?:\/\d{1,3})?/g;

describe('LFG surfaces are theme-token driven (light-mode readability)', () => {
    it('uses no hard-coded zinc/gray neutrals', () => {
        expect(
            offenders(/\b(?:zinc-\d{2,3}|gray-\d{2,3})\b/),
            'zinc/gray are not remapped per data-scheme, so these render dark-on-dark or light-on-light; use text-foreground / text-muted / bg-surface / bg-panel / bg-overlay / bg-faint / border-edge',
        ).toEqual([]);
    });

    it('uses no amber/emerald text shade the ROK-464 light-mode block leaves unmapped', () => {
        expect(
            offenders(ACCENT_TEXT_RE, LIGHT_MAPPED_TEXT),
            'index.css remaps only a fixed list of accent text utilities under [data-scheme="light"]; these are not on it, so they stay pale on a white surface. Use one that is — text-amber-400 or text-emerald-300/400.',
        ).toEqual([]);
    });
});
