import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { AA_SMALL_TEXT, contrastRatio, stripComments } from './wcag-contrast';
import { lightSchemes } from './light-scheme-css';
import { stripComments as stripCodeComments } from '../test/form-primitives-count';

/**
 * Light low-emphasis text guard (ROK-1472).
 *
 * `--color-faint` is a hairline/background value — `#cbd5e1` in the shared light block —
 * and as text it reads at 1.2–1.9:1 on every light scheme. So `text-faint` may only
 * paint marks that carry no information (a separator dot, an empty-state icon), and
 * every such element must be `aria-hidden`. Readable low-emphasis text — placeholders,
 * disabled labels, relative times — is `text-dim`, which this guard holds at AA on the
 * default light scheme's surface, panel and overlay.
 *
 * Scope: `quest-log` (a `data-variant` on top of `data-scheme="light"`), `sky`, `dawn`,
 * `holy` and `celestial` each declare their own tinted `--color-dim`; raising those is an
 * open design call, so only the default `light` scheme is pinned here.
 *
 * Comments are stripped FIRST (CSS and TSX), so prose naming a class can neither satisfy
 * nor trip a check.
 */

const SRC = resolve(__dirname, '..');

/** `text-faint` (any variant prefix or `/NN` alpha), `placeholder:text-faint`, `placeholder-faint`. */
const FAINT_TEXT = /(?<![\w-])(?:[\w-]+:)*(?:text|placeholder)-faint(?![\w-])/g;

/** A JSX tag name right after `<`: `<span`, `<svg`, `<Icon.Bell`. */
const TAG_OPEN = /<[A-Za-z][\w.:-]*(?=[\s/>])/g;

/** `aria-hidden`, `aria-hidden="true"` or `aria-hidden={true}` as a whole attribute. */
const ARIA_HIDDEN = /\saria-hidden(?:=(?:"true"|'true'|\{true\}))?(?=[\s/>])/;

/** Index just past the `>` that closes the opening tag starting at `from`, or -1. */
function tagEnd(src: string, from: number): number {
    let depth = 0;
    let quote = '';
    for (let i = from; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            if (c === quote) quote = '';
            continue;
        }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) return i + 1;
    }
    return -1;
}

/** The JSX opening tag whose attributes contain index `at`, or `null` when `at` is not inside one. */
function enclosingTag(src: string, at: number): string | null {
    const opens = [...src.slice(0, at).matchAll(TAG_OPEN)];
    const start = opens[opens.length - 1]?.index;
    if (start === undefined) return null;
    const end = tagEnd(src, start);
    return end > at ? src.slice(start, end) : null;
}

interface FaintUse {
    where: string;
    cls: string;
    /** The opening tag the class sits in; `null` for a class string outside any JSX tag. */
    tag: string | null;
}

/** Every faint text class in shipped markup — `web/src` minus `dev/` and test files. */
function faintUses(): FaintUse[] {
    const files = (readdirSync(SRC, { recursive: true }) as string[])
        .map((f) => f.split(sep).join('/'))
        .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.startsWith('dev/'));
    return files.sort().flatMap((f) => {
        const raw = readFileSync(join(SRC, f), 'utf-8');
        const code = stripCodeComments(raw);
        return [...code.matchAll(FAINT_TEXT)].map((m) => {
            const tag = enclosingTag(code, m.index);
            const line = raw.slice(0, Math.max(raw.indexOf(tag ?? m[0]), 0)).split('\n').length;
            return { where: `${f}:${line}`, cls: m[0], tag };
        });
    });
}

const USES = faintUses();

describe('text-faint is decorative-only (ROK-1472)', () => {
    it.each([
        ['a ternary className', '<span className={x ? "text-faint" : ""} aria-hidden>·</span>', true],
        ['an arrow handler before the class', '<svg onClick={() => go(a > b)} className="text-faint">', false],
        ['aria-hidden={true}', '<Icon className="w-4 text-faint" aria-hidden={true} />', true],
        ['aria-hidden="false"', '<span aria-hidden="false" className="text-faint">', false],
    ])('the tag reader handles %s', (_name, src, hidden) => {
        const tag = enclosingTag(src, src.indexOf('text-faint'));
        expect(tag, `no opening tag found around text-faint in ${src}`).not.toBeNull();
        expect(ARIA_HIDDEN.test(tag ?? '')).toBe(hidden);
    });

    it('the tag reader rejects a class string outside any JSX tag', () => {
        const src = "const cls = 'text-faint';\nreturn <span className={cls}>·</span>;";
        expect(enclosingTag(src, src.indexOf('text-faint'))).toBeNull();
    });

    it('the scanner reads markup: it finds at least one text-faint inside a JSX tag', () => {
        expect(USES.filter((u) => u.tag !== null).length, 'no text-faint found in web/src — the scanner is not reading markup').toBeGreaterThanOrEqual(1);
    });

    it('every text-faint / placeholder-faint outside web/src/dev is on an aria-hidden element', () => {
        const readable = USES.filter((u) => u.tag === null || !ARIA_HIDDEN.test(u.tag)).map(
            (u) => `${u.where} ${u.cls} in ${u.tag?.slice(0, 90) ?? '(a class string outside any JSX tag)'}`,
        );
        expect(
            readable,
            '--color-faint is 1.2–1.9:1 as text on every light scheme. Mark a decorative separator/icon aria-hidden="true"; use text-dim (or text-muted) for anything a reader needs',
        ).toEqual([]);
    });
});

const css = stripComments(readFileSync(join(SRC, 'index.css'), 'utf-8'));

/** `[data-scheme="light"] { … }` first, then the shared `:is(… [data-scheme="light"] …) { … }` token blocks. */
const LIGHT_BLOCKS = [...css.matchAll(/(?:^|[\s}])(\[data-scheme="light"\]|:is\([^()]*\[data-scheme="light"\][^()]*\))\s*\{([^}]*)\}/g)]
    .sort(([, a], [, b]) => Number(a.startsWith(':is')) - Number(b.startsWith(':is')))
    .map(([, , body]) => body);

/** `--color-{token}` as the default `light` scheme resolves it. */
function lightToken(token: string): string {
    const pattern = new RegExp(`--color-${token}:\\s*(#[0-9a-fA-F]{6})`);
    for (const body of LIGHT_BLOCKS) {
        const hit = pattern.exec(body);
        if (hit) return hit[1].toLowerCase();
    }
    return '';
}

const LIGHT = lightSchemes(css).find((s) => s.name === 'light');
const DIM = lightToken('dim');
const BACKGROUNDS = [
    ['--color-surface', LIGHT?.surface ?? ''],
    ['--color-panel', LIGHT?.panel ?? ''],
    ['--color-overlay', lightToken('overlay')],
] as const;

describe('light --color-dim is readable text (ROK-1472)', () => {
    it('reads the light scheme tokens out of index.css', () => {
        expect(LIGHT, 'lightSchemes() found no `light` scheme').toBeDefined();
        expect(lightToken('surface'), 'this guard and lightSchemes() disagree on the light surface').toBe(LIGHT?.surface);
        for (const hex of [DIM, ...BACKGROUNDS.map(([, bg]) => bg)]) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    });

    it.each(BACKGROUNDS)('light --color-dim clears AA on %s', (name, bg) => {
        const ratio = contrastRatio(DIM, bg);
        expect(
            ratio,
            `light --color-dim ${DIM} is ${ratio}:1 on ${name} (${bg}) — placeholders, disabled and relative-time text need ${AA_SMALL_TEXT}:1`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
});
