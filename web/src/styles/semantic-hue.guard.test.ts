import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    baselineEntries, baselineViolations, countSemanticHues, countTree, inScope, nextBaseline, serializeBaseline,
} from './semantic-hue.count';

/**
 * Semantic-hue ratchet (ROK-1586, TDB:1770).
 *
 * Success / warning / danger meaning must use the tokens (`text-success`,
 * `bg-warning/10`, `border-danger/40`, …), not a raw emerald / green / amber /
 * yellow / red / rose utility (design-system.md §2.2). The existing raw sites
 * are frozen in `semantic-hue.baseline.json` (`{path: count}` + `__total`) and
 * the list only shrinks: a new file fails, a count above its baseline fails,
 * and a count BELOW its baseline fails ("lower baseline for <path> to N") so a
 * conversion locks in its gain. A file whose hues are categorical by design is
 * named, with a reason, in `semantic-hue.categorical.json` — the only way a new
 * file enters the baseline. Regenerate with `node web/scripts/semantic-hue-baseline.mjs`.
 */

const SRC = resolve(__dirname, '..');
const BASELINE_PATH = resolve(__dirname, 'semantic-hue.baseline.json');
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Record<string, number>;
const categorical = JSON.parse(readFileSync(resolve(__dirname, 'semantic-hue.categorical.json'), 'utf-8')) as Record<string, string>;
const reader = { list: (root: string) => readdirSync(root, { recursive: true }) as string[], read: (p: string) => readFileSync(p, 'utf-8') };

describe('semantic-hue ratchet (ROK-1586, TDB:1770)', () => {
    it('no raw semantic hue beyond the frozen baseline', () => {
        expect(baselineViolations(countTree(SRC, reader), baseline, categorical)).toEqual([]);
    });

    it('the baseline file is exactly what the generator writes (sorted, __total first)', () => {
        expect(readFileSync(BASELINE_PATH, 'utf-8')).toBe(serializeBaseline(baselineEntries(baseline)));
    });
});

describe('semantic-hue ratchet — mutation tests', () => {
    const base = { __total: 2, 'pages/a.tsx': 2 };

    it('fails on a file that is not in the baseline', () => {
        expect(baselineViolations({ 'pages/a.tsx': 2, 'pages/new.tsx': 1 }, base, {})).toEqual([
            expect.stringContaining('new raw semantic hue in pages/new.tsx: use text-success/bg-danger/… or add it to semantic-hue.categorical.json with a reason'),
        ]);
    });

    it('fails when a count rises above its baseline, categorical or not', () => {
        expect(baselineViolations({ 'pages/a.tsx': 3 }, base, {})).toEqual([expect.stringContaining('pages/a.tsx: 3 raw semantic hue(s), baseline 2')]);
        expect(baselineViolations({ 'pages/a.tsx': 3 }, base, { 'pages/a.tsx': 'chart series' })).toEqual([expect.stringContaining('never raises')]);
    });

    it('fails when a count drops below its baseline, asking to lower it', () => {
        expect(baselineViolations({ 'pages/a.tsx': 1 }, base, {})).toEqual([expect.stringContaining('lower baseline for pages/a.tsx to 1')]);
        expect(baselineViolations({}, base, {})).toEqual([expect.stringContaining('lower baseline for pages/a.tsx to 0')]);
    });

    it('passes on an exact match', () => {
        expect(baselineViolations({ 'pages/a.tsx': 2 }, base, {})).toEqual([]);
    });

    it('fails when __total is not the sum of the entries', () => {
        expect(baselineViolations({ 'pages/a.tsx': 2 }, { __total: 5, 'pages/a.tsx': 2 }, {})).toEqual([expect.stringContaining('__total is 5, the entries sum to 2')]);
        expect(baselineViolations({ 'pages/a.tsx': 2 }, { 'pages/a.tsx': 2 }, {})).toEqual([expect.stringContaining('__total is missing')]);
    });

    it('lets a NEW file in only when it is allowlisted categorical AND in the baseline', () => {
        const chart = { 'charts/x.tsx': 'chart series' };
        expect(baselineViolations({ 'charts/x.tsx': 3 }, { __total: 3, 'charts/x.tsx': 3 }, chart)).toEqual([]);
        expect(baselineViolations({ 'charts/x.tsx': 3 }, { __total: 0 }, chart)).toEqual([expect.stringContaining('allowlisted as categorical but not in the baseline')]);
    });

    it('fails on a stale allowlist entry and on one with no reason', () => {
        expect(baselineViolations({ 'pages/a.tsx': 2 }, base, { 'pages/gone.tsx': 'genre badge' })).toEqual([expect.stringContaining('stale categorical entry pages/gone.tsx')]);
        expect(baselineViolations({ 'pages/a.tsx': 2 }, base, { 'pages/a.tsx': ' ' })).toEqual([expect.stringContaining('needs a one-line reason')]);
    });

    it('counts every utility family, any shade and alpha, and ignores tokens and other hues', () => {
        expect(countSemanticHues('hover:bg-red-500/20 text-emerald-400 border-amber-500/30 ring-rose-300 from-green-50 fill-yellow-600')).toBe(6);
        expect(countSemanticHues('text-success bg-danger/10 border-warning/40 text-blue-400 bg-emerald text-red')).toBe(0);
    });

    it('counts directional borders and shadow colours, and still ignores them on a token', () => {
        expect(countSemanticHues('border-l-red-500')).toBe(1);
        expect(countSemanticHues('shadow-emerald-500/30')).toBe(1);
        expect(countSemanticHues('border-t-emerald-500 border-x-amber-400 border-e-rose-300 hover:shadow-red-500/20')).toBe(4);
        expect(countSemanticHues('border-l-primary border-t-success shadow-danger/30 shadow-lg')).toBe(0);
    });

    it('ignores hues inside line, block and JSX comments but keeps string literals', () => {
        expect(countSemanticHues('// text-red-400\n/* bg-emerald-500 */\n{/* border-amber-300 */}\nconst c = "text-rose-400";')).toBe(1);
    });

    it('scopes to shipped .ts/.tsx, excluding tests, test/ and dev/', () => {
        expect(['pages/a.tsx', 'lib/a.ts'].filter(inScope)).toEqual(['pages/a.tsx', 'lib/a.ts']);
        expect(['pages/a.test.tsx', 'lib/a.spec.ts', 'test/f.ts', 'dev/w.tsx', 'index.css', 'x.md'].filter(inScope)).toEqual([]);
    });

    it('countTree walks the reader and keeps only files with a hit', () => {
        const files: Record<string, string> = { 'r/a.tsx': 'text-red-400', 'r/b.tsx': 'text-success', 'r/c.test.tsx': 'bg-red-500' };
        const fake = { list: () => ['a.tsx', 'b.tsx', 'c.test.tsx'], read: (p: string) => files[p] ?? '' };
        expect(countTree('r', fake)).toEqual({ 'a.tsx': 1 });
    });
});

describe('semantic-hue generator — nextBaseline', () => {
    const base = { __total: 5, 'a.tsx': 3, 'b.tsx': 2 };

    it('lowers counts and drops emptied entries', () => {
        expect(nextBaseline({ 'a.tsx': 1 }, base, {})).toEqual({ counts: { 'a.tsx': 1 }, errors: [] });
    });

    it('refuses a rise and a new non-categorical file', () => {
        const { errors } = nextBaseline({ 'a.tsx': 4, 'b.tsx': 2, 'c.tsx': 1 }, base, {});
        expect(errors).toEqual([expect.stringContaining('the generator only lowers counts'), expect.stringContaining('new raw semantic hue in c.tsx')]);
    });

    it('adds a new file that is allowlisted categorical; --init takes everything', () => {
        expect(nextBaseline({ 'a.tsx': 3, 'b.tsx': 2, 'c.tsx': 1 }, base, { 'c.tsx': 'genre' }).counts).toEqual({ 'a.tsx': 3, 'b.tsx': 2, 'c.tsx': 1 });
        expect(nextBaseline({ 'z.tsx': 9 }, base, {}, true)).toEqual({ counts: { 'z.tsx': 9 }, errors: [] });
    });

    it('serializes __total first, then sorted paths', () => {
        expect(serializeBaseline({ 'b.tsx': 2, 'a.tsx': 1 })).toBe('{\n  "__total": 3,\n  "a.tsx": 1,\n  "b.tsx": 2\n}\n');
    });
});
