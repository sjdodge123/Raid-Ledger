import { describe, it, expect } from 'vitest';
import { defined } from '../test/defined';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { composite, contrastRatio, stripComments } from './wcag-contrast';
import { lightSchemes, parseSchemeGroup } from './light-scheme-css';
import { stripComments as stripCodeComments } from '../test/form-primitives-count';
import { FIELD_FRAME_BASE } from '../components/ui/form-classes';

/**
 * Light-family amber fill guard (TDB:1493) and the quest-log invalid-border guard (TDB:1888).
 *
 * A raw `bg-amber-500/NN` tint is a dark-first wash: on the six light schemes `index.css`
 * swaps it for an `amber-100` wash (and a hover for one step darker). A class with no such
 * rule paints raw amber-500 alpha on a light panel — the role badge, the DemoDataCard badge
 * and the LFG "now" urgency chip all used `bg-amber-500/20`, which had no rule.
 */

const css = stripComments(readFileSync(resolve(__dirname, '../index.css'), 'utf-8'));
const SCHEMES = lightSchemes(css);
const LIGHT = SCHEMES.map((s) => s.name);

const AMBER_100 = '#fef3c7';
const AMBER_200 = '#fde68a';

/** `:is(<schemes>) .[hover\:]bg-amber-500\/NN[:hover] { background-color: rgba(...) }` */
const FILL_RULE =
    /:is\(([^()]*)\)\s+\.(hover\\:)?bg-amber-500\\\/(\d{1,3})(?::hover)?\s*\{\s*background-color:\s*rgba\(([^)]*)\)\s*;?\s*\}/g;

interface Fill {
    rgb: string;
    alpha: number;
}

/** Every amber fill rule scoped to exactly the light scheme set, keyed by its markup class. */
function lightAmberFills(): Map<string, Fill> {
    const fills = new Map<string, Fill>();
    for (const [, group, hover, alpha, raw] of css.matchAll(FILL_RULE)) {
        const names = parseSchemeGroup(defined(group, 'scheme group'));
        if (!names || names.length !== LIGHT.length || !LIGHT.every((n) => names.includes(n))) continue;
        const [r, g, b, a] = defined(raw, 'rgba channels').split(',').map((n) => Number(n.trim()));
        const rgb = `#${[r, g, b].map((c) => defined(c, 'rgb channel').toString(16).padStart(2, '0')).join('')}`;
        fills.set(`${hover ? 'hover:' : ''}bg-amber-500/${alpha}`, { rgb, alpha: defined(a, 'alpha channel') });
    }
    return fills;
}

const FILLS = lightAmberFills();

/**
 * Every `bg-amber-500/NN` and `hover:bg-amber-500/NN` (NN ≤ 30, the tint range) written in
 * shipped markup — `web/src` minus the DEMO_MODE-only `dev/` tree and test files, comments
 * stripped. Other variants (`dark:`, `group-hover:`, `md:`) compile to different classes and
 * are out of scope here.
 */
const SRC = resolve(__dirname, '..');
const AMBER_FILL = /(?<![\w:-])(hover:)?bg-amber-500\/(\d{1,3})(?![\w-])/g;

/** Every amber tint (NN ≤ 30) in one file's source, each at the line it sits on. */
function amberFillsIn(file: string, src: string): { where: string; cls: string }[] {
    const code = stripCodeComments(src); // keeps every newline, so an offset maps to its source line
    return [...code.matchAll(AMBER_FILL)]
        .filter(([, , alpha]) => Number(alpha) <= 30)
        .map((m) => ({
            where: `${file}:${code.slice(0, m.index).split('\n').length}`,
            cls: `${m[1] ?? ''}bg-amber-500/${m[2]}`,
        }));
}

function amberFillUses(): { where: string; cls: string }[] {
    const files = (readdirSync(SRC, { recursive: true }) as string[])
        .map((f) => f.split(sep).join('/'))
        .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.startsWith('dev/'));
    return files.sort().flatMap((f) => amberFillsIn(f, readFileSync(join(SRC, f), 'utf-8')));
}

const USES = amberFillUses();

/** Unrepainted on 2026-10-01 and logged in TECH-DEBT-BACKLOG.md. Delete an entry when its rule lands. */
const KNOWN_UNREPAINTED = ['bg-amber-500/5', 'hover:bg-amber-500/10'];

describe('raw amber fills on the light schemes (TDB:1493)', () => {
    it('reads the light block and the markup', () => {
        expect([...LIGHT].sort()).toEqual(['celestial', 'dawn', 'holy', 'light', 'quest-log', 'sky']);
        expect(FILLS.has('bg-amber-500/10'), 'no light `bg-amber-500/NN` rule parsed out of index.css').toBe(true);
        expect(USES.some((u) => u.cls === 'bg-amber-500/10'), 'the scanner is not reading web/src').toBe(true);
    });

    it('reports each tint at its own line, past hover: look-alikes and comments', () => {
        const src = '<a className="hover:bg-amber-500/20" />\n/* was bg-amber-500/20\n   here */\n<b className="bg-amber-500/20" />';
        expect(amberFillsIn('x.tsx', src)).toEqual([
            { where: 'x.tsx:1', cls: 'hover:bg-amber-500/20' },
            { where: 'x.tsx:4', cls: 'bg-amber-500/20' },
        ]);
    });

    it('every bg-amber-500/NN and hover:bg-amber-500/NN (NN ≤ 30) in shipped markup has a light rule', () => {
        const missing = USES.filter((u) => !FILLS.has(u.cls) && !KNOWN_UNREPAINTED.includes(u.cls));
        expect(
            missing.map((u) => `${u.where} ${u.cls}`),
            'these amber tints have NO light rule in index.css — they paint raw amber-500 alpha on a light panel',
        ).toEqual([]);
    });

    it.each(KNOWN_UNREPAINTED)('known gap %s is still used and still unrepainted (else drop it from the list)', (cls) => {
        expect(USES.some((u) => u.cls === cls), `${cls} is no longer used`).toBe(true);
        expect(FILLS.has(cls), `${cls} now has a light rule`).toBe(false);
    });

    it('bg-amber-500/20 paints the amber-100 wash', () => {
        expect(FILLS.get('bg-amber-500/20')?.rgb, 'bg-amber-500/20 has no amber-100 light rule').toBe(AMBER_100);
    });

    it.each(SCHEMES)('hover:bg-amber-500/30 is a visible step over bg-amber-500/20 on $name', ({ panel }) => {
        const base = FILLS.get('bg-amber-500/20');
        const hover = FILLS.get('hover:bg-amber-500/30');
        expect(hover?.rgb, 'hover:bg-amber-500/30 has no amber-200 light rule').toBe(AMBER_200);
        if (!base || !hover) return;
        const step = contrastRatio(composite(base.rgb, panel, base.alpha), composite(hover.rgb, panel, hover.alpha));
        expect(step, `hover step is ${step}:1 over ${panel} — invisible`).toBeGreaterThanOrEqual(1.03);
    });
});

/** Split a selector list on its top-level commas (`:where(:not(a, b))` stays whole). */
function splitSelectors(list: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of list) {
        if (ch === ',' && depth === 0) {
            out.push(cur.trim());
            cur = '';
            continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        cur += ch;
    }
    return [...out, cur.trim()];
}

/** A declaration that sets a border colour with `!important` (shorthand or longhand, any side). */
const IMPORTANT_BORDER =
    /\bborder(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?\s*:[^;]*!important/;

/** Every quest-log selector whose rule forces a border colour with `!important`. */
const QL_IMPORTANT_BORDERS = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ sel: defined(sel, 'rule selector'), body: defined(body, 'rule body') }))
    .filter(({ sel, body }) => sel.includes('[data-variant="quest-log"]') && IMPORTANT_BORDER.test(body))
    .flatMap(({ sel, body }) => splitSelectors(sel.split(';').pop() ?? '').map((s) => ({ sel: s, body })));

/** A form control rendered the way the primitives render it, inside the quest-log variant. */
function questLogControl(tag: 'input' | 'select' | 'textarea'): Element {
    const root = document.createElement('div');
    root.setAttribute('data-variant', 'quest-log');
    const el = document.createElement(tag);
    el.className = FIELD_FRAME_BASE;
    el.setAttribute('aria-invalid', 'true');
    root.append(el);
    return el;
}

function questLogCard(cls: string): Element {
    const root = document.createElement('div');
    root.setAttribute('data-variant', 'quest-log');
    const el = document.createElement('div');
    el.className = `${cls} rounded-xl p-4`;
    root.append(el);
    return el;
}

const CONTROLS = ['input', 'select', 'textarea'] as const;

describe('quest-log invalid form controls (TDB:1888)', () => {
    const FOCUS = /\[data-variant="quest-log"\]\s+input:focus/.exec(css);
    const INVALID = [...css.matchAll(/(\[data-variant="quest-log"\][^{}]*\[aria-invalid="true"\][^{}]*)\{([^}]*)\}/g)];
    const DANGER = INVALID.find(([, , body]) => /border-color:\s*var\(--color-danger\)/.test(defined(body, 'rule body')));

    it('an aria-invalid rule paints input, select and textarea with the danger border', () => {
        expect(DANGER?.[1], 'no [data-variant="quest-log"] [aria-invalid="true"] rule sets border-color: var(--color-danger)').toBeDefined();
        for (const tag of CONTROLS) {
            const hit = splitSelectors(DANGER?.[1] ?? '').some((sel) => questLogControl(tag).matches(sel));
            expect(hit, `the danger rule does not match an invalid quest-log <${tag}>`).toBe(true);
        }
    });

    it('it comes after the quest-log :focus rule, so it also wins while focused', () => {
        expect(FOCUS, 'the quest-log input:focus rule was not found').not.toBeNull();
        expect(DANGER?.index ?? -1, 'the aria-invalid rule is missing or precedes the :focus rule').toBeGreaterThan(FOCUS?.index ?? Infinity);
    });

    it.each(CONTROLS)('no quest-log !important border rule reaches a <%s> form control', (tag) => {
        expect(QL_IMPORTANT_BORDERS.length, 'no quest-log !important border rule parsed out of index.css').toBeGreaterThan(0);
        const el = questLogControl(tag);
        expect(
            QL_IMPORTANT_BORDERS.filter(({ sel }) => el.matches(sel)).map(({ sel }) => sel),
            `these !important border rules override the invalid <${tag}>'s danger border (form controls carry bg-panel)`,
        ).toEqual([]);
    });

    it.each(['bg-panel', 'bg-panel/50'])('a quest-log %s card still gets the parchment border', (cls) => {
        const el = questLogCard(cls);
        const hits = QL_IMPORTANT_BORDERS.filter(({ sel, body }) => el.matches(sel) && body.includes('--ql-parchment-edge'));
        expect(hits.length, `no parchment-edge border rule matches a quest-log .${cls} card`).toBeGreaterThan(0);
    });

    it('the card rule excludes controls inside :where(), adding no specificity over later card rules', () => {
        const cards = QL_IMPORTANT_BORDERS.filter(({ sel }) => sel.includes('bg-panel'));
        // drop each `:where(...)` group (one paren level deep, e.g. `:where(:not(a, b))`)
        const bare = cards.map(({ sel }) => sel.replace(/:where\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ''));
        expect(cards.length, 'the bg-panel card rule was not found').toBeGreaterThan(0);
        expect(bare.filter((sel) => sel.includes(':not(')), 'a bare :not() raises the card rule over .rounded-xl').toEqual([]);
    });
});
