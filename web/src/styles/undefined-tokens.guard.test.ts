import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Undefined colour-token guard (ROK-1645).
 *
 * A Tailwind colour utility (`bg-accent`, `ring-primary`) or a `var(--color-*)` whose
 * token is not declared in `index.css` compiles to nothing (or to its hardcoded
 * fallback): the button has no fill, the focus ring never paints. That shipped as the
 * invisible cron-job Save button and the feedback dialog's dead focus state (ROK-1644 §2).
 *
 * Every non-test `web/src` `.ts`/`.tsx` file is scanned for colour utilities (every
 * colour-capable prefix, the v4 `bg-(--color-x)` shorthand and `theme(--color-x)`);
 * every `.css` file is scanned for `var(--color-x)` / `theme(--color-x)` only (its
 * property names are not classes). `X` must be a declared token, a Tailwind palette
 * shade, or a CSS keyword. Comments are stripped FIRST, by a scanner that knows string
 * literals, so prose can never trip the scan and a glob like a star-slash-star inside a
 * string can never open a fake comment. Test files are skipped: they describe classes.
 */

const SRC_ROOT = resolve(__dirname, '..');

/** Length of the comment starting at `i`, or 0. CSS has no `//` comments; `://` is a URL. */
function commentLength(src: string, i: number, lineComments: boolean): number {
    if (src[i] !== '/') return 0;
    if (src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        return (end === -1 ? src.length : end + 2) - i;
    }
    if (!lineComments || src[i + 1] !== '/' || src[i - 1] === ':') return 0;
    const end = src.indexOf('\n', i);
    return (end === -1 ? src.length : end) - i;
}

/**
 * Blank out comments, keeping newlines so reported line numbers stay true. Quotes open a
 * string that nothing inside can end early; `'`/`"` strings also close at a newline, so a
 * stray JSX apostrophe (`Don't`) can shield at most one line.
 */
function stripComments(src: string, lineComments = true): string {
    let out = '';
    let quote: string | null = null;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quote !== null) {
            if (c === '\\') { out += c + (src[i + 1] ?? ''); i++; continue; }
            if (c === quote || (c === '\n' && quote !== '`')) quote = null;
            out += c;
            continue;
        }
        const len = commentLength(src, i, lineComments);
        if (len > 0) {
            out += src.slice(i, i + len).replace(/[^\n]/g, '');
            i += len - 1;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') quote = c;
        out += c;
    }
    return out;
}

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

/** Every `--color-X` declared in `@theme`: the only ones Tailwind turns into utilities. */
function declaredTokens(css: string): Set<string> {
    const block = themeBlock(stripComments(css, false));
    return new Set([...block.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/** Every `--color-X` declared anywhere in `index.css` (`@theme` or a scheme block): valid in `var()`. */
function declaredVars(css: string): Set<string> {
    return new Set([...stripComments(css, false).matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

const PALETTE =
    /^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|[1-9]00|950)$/;
const KEYWORDS = new Set(['white', 'black', 'transparent', 'current', 'inherit', 'none']);

/** Non-colour suffixes each colour-capable prefix also takes (sizes, sides, styles, stops). */
const NON_COLOUR: Record<string, RegExp> = {
    text: /^(xs|sm|base|lg|[2-9]?xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/,
    border: /^(\d+|[xytblrse](-\d+)?|solid|dashed|dotted|double|hidden|collapse|separate|spacing(-.+)?)$/,
    'ring-offset': /^\d+$/,
    ring: /^(\d+|inset)$/,
    bg: /^(gradient-to-.+|linear-.+|radial|conic|fixed|local|scroll|clip-.+|origin-.+|no-repeat|repeat(-.+)?|cover|contain|auto|center|top|bottom|left|right|left-top|left-bottom|right-top|right-bottom|blend-.+)$/,
    'outline-offset': /^\d+$/,
    outline: /^(\d+|hidden|dashed|dotted|double|solid)$/,
    accent: /^auto$/,
    fill: /^$/,
    stroke: /^(\d+|dasharray|dashoffset|linecap|linejoin|width)$/,
    placeholder: /^$/,
    divide: /^([xy](-\d+)?(-reverse)?|solid|dashed|dotted|double)$/,
    from: /^\d+$/,
    via: /^\d+$/,
    to: /^\d+$/,
    shadow: /^(2xs|xs|sm|md|lg|xl|2xl|inner)$/,
    decoration: /^(\d+|solid|double|dotted|dashed|wavy|auto|from-font|clone|slice)$/,
    caret: /^$/,
};

/** Longest prefixes first, so `ring-offset-x` is never read as `ring` + `offset-x`. */
const PREFIXES = Object.keys(NON_COLOUR).sort((a, b) => b.length - a.length).join('|');
const UTILITY = new RegExp(`(?<![\\w$/-])(${PREFIXES})-([a-z0-9]+(?:-[a-z0-9]+)*)(?:\\/\\d+)?(?![\\w\\-[(.])`, 'g');
/** Tailwind v4 CSS-variable shorthand: `bg-(--color-x)` / `bg-(color:--color-x)`. */
const SHORTHAND = new RegExp(`(?<![\\w$-])(?:${PREFIXES})-\\((?:[a-z-]+:)?--color-([a-z0-9-]+)\\)`, 'g');
const CSS_VAR = /var\(\s*--color-([a-z0-9-]+)/g;
const THEME_FN = /theme\(\s*--color-([a-z0-9-]+)[^)]*\)/g;

/** True when `value` after `prefix-` names a real colour or a non-colour utility. */
function isKnown(prefix: string, value: string, tokens: Set<string>): boolean {
    const side = prefix === 'border' ? /^[xytblrse]-(.+)$/.exec(value) : null;
    if (side !== null && isKnown(prefix, side[1], tokens)) return true;
    return (
        tokens.has(value) || PALETTE.test(value) || KEYWORDS.has(value) || NON_COLOUR[prefix].test(value)
    );
}

/**
 * `from`/`via`/`to`/`shadow`/`decoration`/`caret` collide with slugs and ids (`'from-match'`,
 * the WoW talent key `'shadow-weaving'`). A match that IS its whole string literal is an
 * identifier, not a class list; a colour on those prefixes never renders alone anyway.
 * `KNOWN_WORDS` holds the prose that no rule can tell apart from a class.
 */
const COLLIDING = new Set(['from', 'via', 'to', 'shadow', 'decoration', 'caret']);
const KNOWN_WORDS = new Set(['from-lineup-match']);
function isIdentifier(line: string, m: RegExpMatchArray): boolean {
    if (!COLLIDING.has(m[1])) return false;
    if (KNOWN_WORDS.has(m[0])) return true;
    const [before, after] = [line[(m.index ?? 0) - 1], line[(m.index ?? 0) + m[0].length]];
    return before === after && (before === "'" || before === '"' || before === '`');
}

/** A `--color-X` reference is fine when X is declared (or a palette shade Tailwind's theme defines). */
const isVar = (name: string, vars: Set<string>): boolean => vars.has(name) || PALETTE.test(name);

/** Every undefined colour reference in one comment-stripped line. */
function lineHits(line: string, isCss: boolean, tokens: Set<string>, vars: Set<string>): string[] {
    const hits: string[] = [];
    for (const m of line.matchAll(CSS_VAR)) if (!isVar(m[1], vars)) hits.push(`var(--color-${m[1]})`);
    for (const m of line.matchAll(THEME_FN)) if (!isVar(m[1], vars)) hits.push(m[0]);
    if (isCss) return hits;
    for (const m of line.matchAll(UTILITY)) {
        if (!isKnown(m[1], m[2], tokens) && !isIdentifier(line, m)) hits.push(m[0]);
    }
    for (const m of line.matchAll(SHORTHAND)) if (!isVar(m[1], vars)) hits.push(m[0]);
    return hits;
}

/** Every undefined colour reference in one source, as `file:line: match`. */
function findUndefined(file: string, src: string, tokens: Set<string>, vars: Set<string> = tokens): string[] {
    const isCss = file.endsWith('.css');
    return stripComments(src, !isCss)
        .split('\n')
        .flatMap((line, i) => lineHits(line, isCss, tokens, vars).map((hit) => `${file}:${i + 1}: ${hit}`));
}

/** Every non-test `.ts`/`.tsx`/`.css` file under `dir`. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(tsx?|css)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
    });
}

const INDEX_CSS = readFileSync(join(SRC_ROOT, 'index.css'), 'utf-8');
const TOKENS = declaredTokens(INDEX_CSS);
const VARS = new Set([...TOKENS, ...declaredVars(INDEX_CSS)]);

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

    it('flags every colour-utility form, not just bg/text/border/ring (mutation check)', () => {
        const bad = [
            `const a = 'ring-offset-bogus from-bogus via-bogus to-bogus shadow-bogus decoration-bogus caret-bogus';`,
            `const b = 'outline-bogus fill-bogus stroke-bogus divide-bogus';`,
            `const c = 'bg-(--color-bogus) border-(color:--color-nope)';`,
            `const d = 'bg-[theme(--color-bogus)]';`,
        ].join('\n');
        expect(findUndefined('x.tsx', bad, TOKENS).sort()).toEqual([
            'x.tsx:1: caret-bogus', 'x.tsx:1: decoration-bogus', 'x.tsx:1: from-bogus', 'x.tsx:1: ring-offset-bogus',
            'x.tsx:1: shadow-bogus', 'x.tsx:1: to-bogus', 'x.tsx:1: via-bogus',
            'x.tsx:2: divide-bogus', 'x.tsx:2: fill-bogus', 'x.tsx:2: outline-bogus', 'x.tsx:2: stroke-bogus',
            'x.tsx:3: bg-(--color-bogus)', 'x.tsx:3: border-(color:--color-nope)',
            'x.tsx:4: theme(--color-bogus)',
        ]);
    });

    it('passes the same forms when they name real colours or non-colour values', () => {
        const good = `const a = 'ring-offset-2 ring-offset-surface from-emerald-500 via-success to-transparent from-10% shadow-lg shadow-success/20 decoration-2 decoration-success caret-success outline-offset-2 divide-y divide-edge bg-(--color-success) theme(--color-surface)';`;
        expect(findUndefined('x.tsx', good, TOKENS)).toEqual([]);
        const ids = `type M = 'from-match'; const t = { 'shadow-weaving': 1 }; fetch(\`/plans/from-event/\${id}\`);`;
        expect(findUndefined('x.ts', ids, TOKENS)).toEqual([]);
    });

    it('scans .css for var(--color-*) only, ignoring CSS property names (mutation check)', () => {
        const css = `.a { color: var(--color-text-secondary, #a1a1aa); text-decoration: none; }\n.b { color: var(--color-secondary); border: 1px solid var(--color-edge); }`;
        expect(findUndefined('x.css', css, TOKENS)).toEqual(['x.css:1: var(--color-text-secondary)']);
    });

    it('never strips a "comment" that starts inside a string literal (mutation check)', () => {
        const src = `const g = '**/*.ts'; const c = 'bg-bogus'; /* bg-in-comment */\nconst u = 'https://x.dev'; // text-in-prose`;
        expect(findUndefined('x.ts', src, TOKENS)).toEqual(['x.ts:1: bg-bogus']);
    });

    it('no web/src file references an undeclared colour token', () => {
        const hits = sourceFiles(SRC_ROOT).flatMap((path) =>
            findUndefined(relative(SRC_ROOT, path), readFileSync(path, 'utf-8'), TOKENS, VARS),
        );
        expect(hits, `undeclared colour tokens (declare in index.css @theme or use a real one):\n${hits.join('\n')}`).toEqual([]);
    });
});
