import { describe, it, expect } from 'vitest';
import { at } from '../test/defined';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Static analysis of the badge-overlay CSS rules (ROK-493).
 *
 * TD-1 required removing all !important declarations from badge-overlay rules
 * and replacing them with higher-specificity selectors. These tests validate
 * the CSS source to guard against regression.
 */

const cssPath = resolve(__dirname, '../index.css');
const css = readFileSync(cssPath, 'utf-8');

/**
 * Extract the badge-overlay rule block from the CSS source.
 * Captures from the badge-overlay comment header through the last
 * badge-overlay selector rule (before the next comment block or section).
 */
function extractBadgeOverlayBlock(): string {
    const lines = css.split('\n');
    const startIdx = lines.findIndex((l) => l.includes('Badge overlay:') || l.includes('badge-overlay'));
    if (startIdx === -1) return '';

    // Gather all consecutive lines that are part of the badge-overlay block
    const blockLines: string[] = [];
    for (let i = startIdx; i < lines.length; i++) {
        const line = at(lines, i);
        // Stop when we hit the next CSS section comment
        if (i > startIdx && line.startsWith('/*') && !line.includes('badge-overlay') && !line.includes('Badge overlay')) {
            break;
        }
        // Stop when we hit the next section (non-badge-overlay selector without badge-overlay)
        if (i > startIdx && line.match(/^\[data-scheme/) && !line.includes('badge-overlay')) {
            break;
        }
        blockLines.push(line);
    }
    return blockLines.join('\n');
}

const block = extractBadgeOverlayBlock();

function getDeclarations(prop: string) {
    return block.split('\n').filter((line) => line.includes(prop) && line.includes('.badge-overlay'));
}

describe('badge-overlay CSS — no !important (ROK-493)', () => {
    it('badge-overlay rules exist in index.css', () => {
        expect(block.length).toBeGreaterThan(0);
        expect(block).toContain('.badge-overlay');
    });

    it('badge-overlay rules do NOT use !important on color property', () => {
        const declarations = getDeclarations('color:');
        expect(declarations.length).toBeGreaterThan(0);
        for (const decl of declarations) {
            expect(decl).not.toContain('!important');
        }
    });

    it('badge-overlay rules do NOT use !important on background-color property', () => {
        const declarations = getDeclarations('background-color:');
        expect(declarations.length).toBeGreaterThan(0);
        for (const decl of declarations) {
            expect(decl).not.toContain('!important');
        }
    });

    it('badge-overlay rules do NOT use !important on border-color property', () => {
        const declarations = getDeclarations('border-color:');
        expect(declarations.length).toBeGreaterThan(0);
        for (const decl of declarations) {
            expect(decl).not.toContain('!important');
        }
    });

    it('badge-overlay rules contain zero !important declarations overall', () => {
        const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, '');
        const ruleLines = withoutComments.split('\n').filter((line) => line.trim().length > 0);
        expect(ruleLines.length).toBeGreaterThan(0);
        for (const line of ruleLines) {
            expect(line).not.toContain('!important');
        }
    });
});

describe('badge-overlay CSS — selectors & coverage (ROK-493)', () => {
    it('uses :is(.badge-overlay, .badge-overlay *) selector pattern for specificity', () => {
        expect(block).toContain(':is(.badge-overlay, .badge-overlay *)');
    });

    it('covers text-color overrides for all four status colors', () => {
        expect(block).toContain('.text-emerald-400');
        expect(block).toContain('.text-yellow-400');
        expect(block).toContain('.text-red-400');
        expect(block).toContain('.text-cyan-300');
    });

    it('covers background-color overrides for all four status colors', () => {
        expect(block).toContain('.bg-emerald-500\\/20');
        expect(block).toContain('.bg-yellow-500\\/20');
        expect(block).toContain('.bg-red-500\\/20');
        expect(block).toContain('.bg-cyan-500\\/20');
    });

    it('covers border-color overrides for all four status colors', () => {
        expect(block).toContain('.border-emerald-500\\/30');
        expect(block).toContain('.border-yellow-500\\/30');
        expect(block).toContain('.border-red-500\\/30');
        expect(block).toContain('.border-cyan-500\\/30');
    });

    it('rules are scoped under [data-scheme="light"]', () => {
        const selectorLines = block.split('\n')
            .filter((line) => line.includes('.badge-overlay') && line.includes('{'));
        expect(selectorLines.length).toBeGreaterThan(0);
        for (const line of selectorLines) {
            expect(line).toContain('[data-scheme="light"]');
        }
    });
});

/**
 * Every class a cover-art badge paints that index.css repaints for the light schemes needs a
 * `.badge-overlay` restore, or the badge shows the light-family shade on the dark art. The
 * desktop event card's cover carries the SeriesBadge, the LiveBadge, the Game Time badge and
 * the status badge (STATUS_STYLES).
 */
const SRC = resolve(__dirname, '..');
const read = (f: string) => readFileSync(join(SRC, f), 'utf-8');
const COLOR_CLASS = /(?<![\w:-])(?:text|bg|border)-[a-z]+-\d{2,3}(?:\/\d{1,3})?(?![\w-])/g;

function coverBadgeClasses(): string[] {
    const sources = [
        read('components/events/SeriesBadge.tsx'),
        read('components/events/LiveBadge.tsx'),
        /function GameTimeBadge\(\)[\s\S]*?\n}/.exec(read('components/events/event-card.tsx'))?.[0] ?? '',
        /STATUS_STYLES[^{]*\{[^}]*\}/.exec(read('lib/event-utils.ts'))?.[0] ?? '',
    ];
    return [...new Set(sources.flatMap((src) => src.match(COLOR_CLASS) ?? []))].sort();
}

const COVER_CLASSES = coverBadgeClasses();
const esc = (cls: string) => cls.replace('/', '\\/');
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLightRepainted = (cls: string) =>
    new RegExp(`:is\\(\\[data-scheme="light"\\][^()]*\\)\\s+\\.${reEsc(esc(cls))}\\s*\\{`).test(css);

describe('badge-overlay CSS — every repainted cover-badge class is restored', () => {
    it('the scan reads the cover badges: it finds the SeriesBadge and status classes', () => {
        expect(COVER_CLASSES).toEqual(expect.arrayContaining(['text-indigo-300', 'border-indigo-500/30', 'text-emerald-500', 'text-cyan-300']));
    });

    it.each(COVER_CLASSES)('cover-art badge class %s keeps its dark-theme colour on light', (cls) => {
        if (!isLightRepainted(cls)) return;
        expect(
            css.includes(`:is(.badge-overlay, .badge-overlay *).${esc(cls)} {`),
            `${cls} is repainted for the light schemes but has no .badge-overlay restore — the cover-art badge paints the light shade on dark art`,
        ).toBe(true);
    });
});
