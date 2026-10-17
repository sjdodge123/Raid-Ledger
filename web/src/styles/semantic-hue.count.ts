/**
 * Raw semantic-hue counter for the semantic-hue ratchet (ROK-1586, TDB:1770).
 *
 * Counts every raw emerald / green / amber / yellow / red / rose Tailwind
 * utility — text, bg, border (and the directional `border-{t,r,b,l,x,y,s,e}-`),
 * shadow, ring, fill, stroke, gradient stops, divide, outline, accent,
 * placeholder, decoration; any shade, any `/NN` alpha — per
 * shipped `.ts` / `.tsx` file under `web/src`, after stripping comments with
 * the shared B66 stripper. Tests, `test/**` and the DEMO-only `dev/**` are out
 * of scope. Shared by `semantic-hue.guard.test.ts` and the generator
 * `web/scripts/semantic-hue-baseline.mjs`, so the two can never count
 * differently. Pure string work: the caller hands in the file-system reader.
 */
import { stripComments } from '../test/strip-comments.ts';

/** `{path relative to web/src: raw count}`; a baseline also carries `__total`. */
export type HueCounts = Record<string, number>;
/** `{path: one-line reason}` — files whose raw hues are categorical by design (design-system §2.2). */
export type CategoricalAllowlist = Record<string, string>;

export const TOTAL_KEY = '__total';

const UTILITY = 'text|bg|border-[trblxyse]|border|shadow|ring|fill|stroke|from|to|via|divide|outline|accent|placeholder|decoration';
const HUE = 'emerald|green|amber|yellow|red|rose';
const RAW_SEMANTIC_HUE = new RegExp(String.raw`(?:${UTILITY})-(?:${HUE})-\d{2,3}(?:\/\d+)?`, 'g');
const HINT = 'use text-success/bg-danger/… or add it to semantic-hue.categorical.json with a reason';

/** Raw semantic-hue utilities in one source text, comments excluded. */
export function countSemanticHues(src: string): number {
    return stripComments(src).match(RAW_SEMANTIC_HUE)?.length ?? 0;
}

const posix = (p: string): string => p.split('\\').join('/');

/** Whether a `web/src`-relative path is shipped source the ratchet counts. */
export function inScope(path: string): boolean {
    const p = posix(path);
    return /\.tsx?$/.test(p) && !/\.(test|spec)\./.test(p) && !p.startsWith('test/') && !p.startsWith('dev/');
}

/** The file-system access the tree walk needs (`node:fs` in the guard and the generator). */
export interface TreeReader {
    /** Every path under `root`, relative to it — `readdirSync(root, { recursive: true })`. */
    list(root: string): string[];
    read(path: string): string;
}

/** `{path: count}` for every in-scope file under `root` with at least one raw semantic hue. */
export function countTree(root: string, fs: TreeReader): HueCounts {
    const counts: HueCounts = {};
    for (const file of fs.list(root).map(posix).filter(inScope).sort()) {
        const n = countSemanticHues(fs.read(`${root}/${file}`));
        if (n > 0) counts[file] = n;
    }
    return counts;
}

/** A baseline's per-file entries, without `__total`. */
export function baselineEntries(baseline: HueCounts): HueCounts {
    return Object.fromEntries(Object.entries(baseline).filter(([k]) => k !== TOTAL_KEY));
}

const sum = (c: HueCounts): number => Object.values(c).reduce((a, b) => a + b, 0);

function fileViolation(file: string, n: number, allowed: number | undefined, categorical: CategoricalAllowlist): string | null {
    if (allowed === undefined) {
        return file in categorical
            ? `${file}: ${n} raw semantic hue(s), allowlisted as categorical but not in the baseline — regenerate the baseline`
            : `new raw semantic hue in ${file}: ${HINT} (${n} found)`;
    }
    if (n > allowed) return `${file}: ${n} raw semantic hue(s), baseline ${allowed} — ${HINT.replace(' or add', ' (a categorical file keeps, never raises, its count) or add')}`;
    if (n < allowed) return `${file}: ${n} raw semantic hue(s), baseline ${allowed} — lower baseline for ${file} to ${n}`;
    return null;
}

/** Allowlist entries with no reason, or whose file has no raw hue left (stale). */
export function allowlistViolations(actual: HueCounts, categorical: CategoricalAllowlist): string[] {
    const out: string[] = [];
    for (const [file, reason] of Object.entries(categorical)) {
        if (typeof reason !== 'string' || reason.trim() === '') out.push(`${file}: a categorical entry needs a one-line reason`);
        if (!(file in actual)) out.push(`stale categorical entry ${file}: no raw hues left — remove it from semantic-hue.categorical.json`);
    }
    return out;
}

/** Every way `actual` breaks the baseline or the allowlist; empty when it matches exactly. */
export function baselineViolations(actual: HueCounts, baseline: HueCounts, categorical: CategoricalAllowlist): string[] {
    const base = baselineEntries(baseline);
    const out: string[] = [];
    for (const [file, n] of Object.entries(actual)) {
        const v = fileViolation(file, n, base[file], categorical);
        if (v) out.push(v);
    }
    for (const [file, allowed] of Object.entries(base)) {
        if (!(file in actual)) out.push(`${file}: 0 raw semantic hue(s), baseline ${allowed} — lower baseline for ${file} to 0 (remove the entry)`);
    }
    const total = sum(base);
    if (baseline[TOTAL_KEY] !== total) out.push(`${TOTAL_KEY} is ${baseline[TOTAL_KEY] ?? 'missing'}, the entries sum to ${total} — set ${TOTAL_KEY} to ${total}`);
    return [...out, ...allowlistViolations(actual, categorical)];
}

/**
 * The generator's next baseline: counts only fall and emptied entries drop.
 * A rise, or a new file not in the categorical allowlist, is an error instead.
 * `init` (slice S0 only) takes `actual` wholesale.
 */
export function nextBaseline(actual: HueCounts, baseline: HueCounts, categorical: CategoricalAllowlist, init = false): { counts: HueCounts; errors: string[] } {
    if (init) return { counts: { ...actual }, errors: [] };
    const base = baselineEntries(baseline);
    const counts: HueCounts = {};
    const errors: string[] = [];
    for (const [file, n] of Object.entries(actual)) {
        const allowed = base[file];
        if (allowed === undefined && !(file in categorical)) errors.push(`new raw semantic hue in ${file}: ${HINT} (${n} found)`);
        else if (allowed !== undefined && n > allowed) errors.push(`${file}: ${n} raw semantic hue(s), baseline ${allowed} — the generator only lowers counts`);
        else counts[file] = n;
    }
    return { counts, errors };
}

/** The baseline file's exact text: `__total` first, then the paths sorted. */
export function serializeBaseline(counts: HueCounts): string {
    const sorted = Object.keys(baselineEntries(counts)).sort().map((k) => [k, counts[k] ?? 0] as const);
    return `${JSON.stringify({ [TOTAL_KEY]: sum(baselineEntries(counts)), ...Object.fromEntries(sorted) }, null, 2)}\n`;
}
