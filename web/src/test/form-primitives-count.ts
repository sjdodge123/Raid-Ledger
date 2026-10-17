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
import { stripComments } from './strip-comments';

const RAW_ELEMENT = /<(input|select|textarea|button)\b/g;

/** Re-exported for the importers that predate the shared helper (B66). */
export { stripComments };

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
