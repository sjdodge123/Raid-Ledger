import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { composite, contrastRatio, stripComments } from './wcag-contrast';
import { lightSchemes, parseSchemeGroup } from './light-scheme-css';
import { stripComments as stripCodeComments } from '../test/form-primitives-count';

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
        const names = parseSchemeGroup(group);
        if (!names || names.length !== LIGHT.length || !LIGHT.every((n) => names.includes(n))) continue;
        const [r, g, b, a] = raw.split(',').map((n) => Number(n.trim()));
        const rgb = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
        fills.set(`${hover ? 'hover:' : ''}bg-amber-500/${alpha}`, { rgb, alpha: a });
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

function amberFillUses(): { where: string; cls: string }[] {
    const files = (readdirSync(SRC, { recursive: true }) as string[])
        .map((f) => f.split(sep).join('/'))
        .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.startsWith('dev/'));
    return files.sort().flatMap((f) => {
        const src = readFileSync(join(SRC, f), 'utf-8');
        return [...stripCodeComments(src).matchAll(AMBER_FILL)]
            .filter(([, , alpha]) => Number(alpha) <= 30)
            .map(([, hover, alpha]) => {
                const cls = `${hover ?? ''}bg-amber-500/${alpha}`;
                return { where: `${f}:${src.split('\n').findIndex((l) => l.includes(cls)) + 1}`, cls };
            });
    });
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

describe('quest-log invalid form controls (TDB:1888)', () => {
    const FOCUS = /\[data-variant="quest-log"\]\s+input:focus/.exec(css);
    const INVALID = [...css.matchAll(/(\[data-variant="quest-log"\][^{}]*\[aria-invalid="true"\][^{}]*)\{([^}]*)\}/g)];

    it('an aria-invalid rule paints input, select and textarea with the danger border', () => {
        const rule = INVALID.find(([, , body]) => /border-color:\s*var\(--color-danger\)/.test(body));
        expect(rule?.[1], 'no [data-variant="quest-log"] [aria-invalid="true"] rule sets border-color: var(--color-danger)').toBeDefined();
        for (const el of ['input', 'select', 'textarea']) expect(rule?.[1]).toMatch(new RegExp(`\\b${el}\\b`));
    });

    it('it comes after the quest-log :focus rule, so it also wins while focused', () => {
        const rule = INVALID.find(([, , body]) => /border-color:\s*var\(--color-danger\)/.test(body));
        expect(FOCUS, 'the quest-log input:focus rule was not found').not.toBeNull();
        expect(rule?.index ?? -1, 'the aria-invalid rule is missing or precedes the :focus rule').toBeGreaterThan(FOCUS?.index ?? Infinity);
    });
});
