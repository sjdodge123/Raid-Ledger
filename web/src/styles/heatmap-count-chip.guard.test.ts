import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defined } from '../test/defined';
import { computeHeatmapBg } from '../components/features/game-time/grid-cell.utils';
import { AA_SMALL_TEXT, composite, contrastRatio, stripComments } from './wcag-contrast';

/**
 * ROK-2167: the group heatmap's "N free · N busy" count (`GroupWeekCell` desktop week,
 * `GroupDayView` phone day) sits on the `COUNT_CHIP` surface chip — the ROK-2165 label-chip
 * pattern. Straight on the strongest heat fills the count was 3.5:1 in dark and the busy
 * clause ~1.5:1; light failed on strong green/red.
 *
 * The stack measured: cell base (`--color-surface` or `--color-panel`) → `computeHeatmapBg`'s
 * strongest fill of each hue (swept from the real helper, so a brighter ramp is caught) →
 * `bg-surface/NN` chip (alpha read from the comment-stripped `COUNT_CHIP` literal; 0 when the
 * class is gone, so dropping the chip fails the rows below) → `text-busy` solid and
 * `text-foreground/NN` (alpha read from each component's count class).
 */

const read = (rel: string): string => stripComments(readFileSync(resolve(__dirname, rel), 'utf-8'));
/** Block comments (incl. JSX `{/* … *\/}`) and whole-line `//` comments removed. */
const readTsx = (rel: string): string => read(rel).replace(/^\s*\/\/.*$/gm, '');

const css = read('../index.css');
const GAME_TIME = '../components/features/game-time';
const classesSrc = readTsx(`${GAME_TIME}/week/group-marks.classes.ts`);
const COUNT_SOURCES = [
    ['GroupWeekCell.tsx (desktop week)', readTsx(`${GAME_TIME}/week/GroupWeekCell.tsx`)],
    ['GroupDayView.tsx (phone day)', readTsx(`${GAME_TIME}/phone/GroupDayView.tsx`)],
] as const;

function extractBlock(source: string, startPattern: RegExp): string {
    const match = startPattern.exec(source);
    if (match === null) return '';
    const open = source.indexOf('{', match.index);
    let depth = 0;
    for (let i = open; open !== -1 && i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
    }
    return '';
}

const themeBlock = extractBlock(css, /@theme\s*\{/);
const lightBlock = extractBlock(css, /:is\(\[data-scheme="light"\][^)]*\)\s*\{/);

function token(block: string, name: string): string {
    const pick = (b: string) => new RegExp(`--color-${name}\\s*:\\s*([^;]+);`).exec(b)?.[1]?.trim();
    return defined(pick(block) ?? pick(themeBlock), `--color-${name}`);
}

/** The `COUNT_CHIP` class literal, or '' when the constant is gone. */
const countChip = /export const COUNT_CHIP = '([^']*)'/.exec(classesSrc)?.[1] ?? '';
/** `bg-surface/NN` of the chip as 0–1, or 0 when the chip has no surface fill. */
const CHIP_ALPHA = Number(/(?:^|\s)bg-surface\/(\d+)(?:\s|$)/.exec(countChip)?.[1] ?? 0) / 100;

/** The count span's className template — the one that interpolates `COUNT_CHIP` — or ''. */
const countClass = (src: string): string =>
    [...src.matchAll(/className=\{`([^`]*)`\}/g)].map((m) => m[1] ?? '').find((c) => c.includes('COUNT_CHIP')) ?? '';

/** The strongest `computeHeatmapBg` fill of each hue over every (available, total) up to 12. */
function strongestFills(): Array<readonly [string, string, number]> {
    const best = new Map<string, number>();
    for (let total = 1; total <= 12; total++) {
        for (let available = 0; available <= total; available++) {
            const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(computeHeatmapBg({ available, total }) ?? '');
            if (m === null) continue;
            const hex = `#${[m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
            best.set(hex, Math.max(best.get(hex) ?? 0, Number(m[4])));
        }
    }
    return [...best].map(([hex, alpha]) => [hex, `${hex} @ ${alpha}`, alpha] as const);
}

const FILLS = strongestFills();

function chipRows(): Array<readonly [string, string, string, string]> {
    const families = [['default-dark', themeBlock], ['default-light', lightBlock]] as const;
    return families.flatMap(([family, block]) => (['surface', 'panel'] as const).flatMap((base) =>
        FILLS.flatMap(([hex, fillLabel, alpha]) => {
            const fill = composite(hex, token(block, base), alpha);
            const chip = composite(token(block, 'surface'), fill, CHIP_ALPHA);
            const where = `${family} chip over ${fillLabel} on ${base}`;
            const counts = COUNT_SOURCES.map(([file, src]) => {
                const fgAlpha = Number(/text-foreground\/(\d+)/.exec(countClass(src))?.[1] ?? 100) / 100;
                const fg = composite(token(block, 'foreground'), chip, fgAlpha);
                return [`count text-foreground/${Math.round(fgAlpha * 100)} (${file})`, where, fg, chip] as const;
            });
            return [['busy clause text-busy', where, token(block, 'busy'), chip] as const, ...counts];
        })));
}

describe('heatmap count chip (ROK-2167)', () => {
    it('sweeps the three heat hues out of computeHeatmapBg', () => {
        expect(FILLS, 'expected the green / yellow / red fills').toHaveLength(3);
    });

    it('COUNT_CHIP carries a bg-surface/NN fill', () => {
        expect(CHIP_ALPHA, `COUNT_CHIP "${countChip}" has no bg-surface/NN — the count would sit straight on the heat fill`)
            .toBeGreaterThan(0);
    });

    it.each(COUNT_SOURCES)('%s puts its count on COUNT_CHIP', (file, src) => {
        expect(countClass(src), `${file}: no className interpolating \${COUNT_CHIP}`).toMatch(/text-foreground\/\d+/);
    });

    it.each(chipRows())('%s clears AA: %s', (what, where, fg, bg) => {
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `${what} (${fg}) is ${ratio}:1 on the ${where} (${bg}) — needs ${AA_SMALL_TEXT}:1`)
            .toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
});
