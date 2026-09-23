import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Undefined colour-token guard (ROK-1645).
 *
 * A Tailwind colour utility (`bg-accent`, `ring-primary`) or a `var(--color-*)` whose
 * token is not declared in `index.css`'s `@theme` block compiles to nothing: the
 * button has no fill, the focus ring never paints. That shipped as the invisible
 * cron-job Save button and the feedback dialog's dead focus state (ROK-1644 §2).
 *
 * Every `web/src` source file is scanned for colour utilities and `var(--color-X)`
 * references. `X` must be a declared `@theme` token, a Tailwind palette shade, or a
 * CSS keyword. Comments are stripped FIRST so prose (this block included) can never
 * trip the scan. Test files are skipped: they describe classes, they don't render them.
 */

const SRC_ROOT = resolve(__dirname, '..');

/** Strip block and line comments, keeping newlines so reported line numbers stay true. */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, '')).replace(/(^|\s)\/\/.*$/gm, '$1');

/** Body of the `@theme { ... }` block, brace-balanced. */
function themeBlock(css: string): string {
    const start = css.search(/@theme\s*\{/);
    if (start === -1) return '';
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
    }
    return '';
}

/** Every `--color-X` declared in `@theme`. */
function declaredTokens(css: string): Set<string> {
    const block = themeBlock(stripComments(css));
    return new Set([...block.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

const PALETTE =
    /^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|[1-9]00|950)$/;
const KEYWORDS = new Set(['white', 'black', 'transparent', 'current', 'inherit', 'none']);

/** Non-colour suffixes each colour-capable prefix also takes (sizes, sides, styles). */
const NON_COLOUR: Record<string, RegExp> = {
    text: /^(xs|sm|base|lg|[2-9]?xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/,
    border: /^(\d+|[xytblrse](-\d+)?|solid|dashed|dotted|double|hidden|collapse|separate|spacing(-.+)?)$/,
    ring: /^(\d+|inset|offset(-.+)?)$/,
    bg: /^(gradient-to-.+|linear-.+|radial|conic|fixed|local|scroll|clip-.+|origin-.+|no-repeat|repeat(-.+)?|cover|contain|auto|center|top|bottom|left|right|left-top|left-bottom|right-top|right-bottom|blend-.+)$/,
    outline: /^(\d+|hidden|dashed|dotted|double|solid|offset-.+)$/,
    accent: /^auto$/,
    fill: /^$/,
    stroke: /^(\d+|dasharray|dashoffset|linecap|linejoin|width)$/,
    placeholder: /^$/,
    divide: /^([xy](-\d+)?(-reverse)?|solid|dashed|dotted|double)$/,
};

const UTILITY = /(?<![\w$-])(bg|text|border|ring|outline|accent|fill|stroke|placeholder|divide)-([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/\d+)?(?![\w\-[(.])/g;
const CSS_VAR = /var\(\s*--color-([a-z0-9-]+)/g;

/** True when `value` after `prefix-` names a real colour or a non-colour utility. */
function isKnown(prefix: string, value: string, tokens: Set<string>): boolean {
    const side = prefix === 'border' ? /^[xytblrse]-(.+)$/.exec(value) : null;
    if (side !== null && isKnown(prefix, side[1], tokens)) return true;
    return (
        tokens.has(value) || PALETTE.test(value) || KEYWORDS.has(value) || NON_COLOUR[prefix].test(value)
    );
}

/** Every undefined colour reference in one comment-stripped source, as `file:line: match`. */
function findUndefined(file: string, src: string, tokens: Set<string>): string[] {
    const hits: string[] = [];
    stripComments(src).split('\n').forEach((line, i) => {
        for (const m of line.matchAll(UTILITY)) {
            if (!isKnown(m[1], m[2], tokens)) hits.push(`${file}:${i + 1}: ${m[0]}`);
        }
        for (const m of line.matchAll(CSS_VAR)) {
            if (!tokens.has(m[1])) hits.push(`${file}:${i + 1}: var(--color-${m[1]})`);
        }
    });
    return hits;
}

/** Every non-test `.ts`/`.tsx` file under `dir`. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
    });
}

const TOKENS = declaredTokens(readFileSync(join(SRC_ROOT, 'index.css'), 'utf-8'));

describe('undefined colour tokens (ROK-1645)', () => {
    it('parses the @theme tokens out of index.css', () => {
        expect([...TOKENS]).toEqual(expect.arrayContaining(['surface', 'panel', 'edge', 'success', 'foreground']));
    });

    it('flags a reintroduced undefined token (mutation check)', () => {
        const src = `const a = 'bg-accent ring-primary/50 text-sm'; // bg-bogus in a comment\nstyle={{ color: 'var(--color-border)' }}`;
        expect(findUndefined('x.tsx', src, TOKENS)).toEqual([
            'x.tsx:1: bg-accent',
            'x.tsx:1: ring-primary/50',
            'x.tsx:2: var(--color-border)',
        ]);
    });

    it('no web/src file references an undeclared colour token', () => {
        const hits = sourceFiles(SRC_ROOT).flatMap((path) =>
            findUndefined(relative(SRC_ROOT, path), readFileSync(path, 'utf-8'), TOKENS),
        );
        expect(hits, `undeclared colour tokens (declare in index.css @theme or use a real one):\n${hits.join('\n')}`).toEqual([]);
    });
});
