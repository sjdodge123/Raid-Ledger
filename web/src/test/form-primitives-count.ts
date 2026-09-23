/**
 * Raw form-element counter for the form-primitives guard (ROK-1646).
 *
 * Counts `<input` / `<select` / `<textarea` / `<button` openings per `.tsx`
 * file outside `components/ui/**` and `dev/**` (tests excluded), after
 * stripping comments. The baseline only ever shrinks as call sites migrate
 * to the shared primitives (`Input`, `Select`, `Textarea`, `Button`, …).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAW_ELEMENT = /<(input|select|textarea|button)\b/g;

type Mode = 'code' | 'line' | 'block' | "'" | '"' | '`';

/** Next mode after `c` (and `n`, the following char) in `code` mode. */
function enter(c: string, n: string): Mode {
    if (c === '/' && n === '/') return 'line';
    if (c === '/' && n === '*') return 'block';
    if (c === "'" || c === '"' || c === '`') return c;
    return 'code';
}

/**
 * Strip `//` and block comments, leaving string contents alone (a URL's `//`
 * inside quotes is not a comment). Quote strings end at a newline, so an
 * apostrophe in JSX text ("Don't") can hide at most the rest of its line.
 */
export function stripComments(src: string): string {
    let out = '';
    let mode: Mode = 'code';
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        const n = src[i + 1] ?? '';
        if (mode === 'code') {
            mode = enter(c, n);
            if (mode === 'line' || mode === 'block') { i++; continue; }
            out += c;
        } else if (mode === 'line') {
            if (c === '\n') { mode = 'code'; out += c; }
        } else if (mode === 'block') {
            if (c === '*' && n === '/') { mode = 'code'; i++; }
        } else {
            out += c;
            if (c === '\\') { out += n; i++; } else if (c === mode || (c === '\n' && mode !== '`')) mode = 'code';
        }
    }
    return out;
}

/** Raw form elements in one source text, comments excluded. */
export function countRawFormElements(src: string): number {
    return stripComments(src).match(RAW_ELEMENT)?.length ?? 0;
}

/** Whether a `web/src`-relative path is in the guard's scope. */
export function inScope(path: string): boolean {
    const p = path.split(sep).join('/');
    return p.endsWith('.tsx') && !p.endsWith('.test.tsx')
        && !p.startsWith('components/ui/') && !p.startsWith('dev/');
}

/** `{path: count}` for every in-scope file under `root` with at least one raw element. */
export function countTree(root: string): Record<string, number> {
    const counts: Record<string, number> = {};
    const files = (readdirSync(root, { recursive: true }) as string[]).map((f) => relative(root, join(root, f)));
    for (const f of files.filter(inScope).sort()) {
        const n = countRawFormElements(readFileSync(join(root, f), 'utf-8'));
        if (n > 0) counts[f.split(sep).join('/')] = n;
    }
    return counts;
}

/** Every way `actual` breaks the baseline; empty when it matches exactly. */
export function baselineViolations(actual: Record<string, number>, baseline: Record<string, number>): string[] {
    const out: string[] = [];
    for (const [file, n] of Object.entries(actual)) {
        const allowed = baseline[file];
        if (allowed === undefined) out.push(`${file}: ${n} raw form element(s) in a file not in the baseline — use the components/ui primitives`);
        else if (n > allowed) out.push(`${file}: ${n} raw form element(s), baseline ${allowed} — use the components/ui primitives`);
        else if (n < allowed) out.push(`${file}: ${n} raw form element(s), baseline ${allowed} — lower baseline to ${n}`);
    }
    for (const [file, allowed] of Object.entries(baseline)) {
        if (!(file in actual)) out.push(`${file}: 0 raw form element(s), baseline ${allowed} — lower baseline to 0 (remove the entry)`);
    }
    return out;
}
