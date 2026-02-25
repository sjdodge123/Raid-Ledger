import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
        const line = lines[i];
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

describe('badge-overlay CSS rules (ROK-493)', () => {
    const block = extractBadgeOverlayBlock();

    it('badge-overlay rules exist in index.css', () => {
        expect(block.length).toBeGreaterThan(0);
        expect(block).toContain('.badge-overlay');
    });

    it('badge-overlay rules do NOT use !important on color property', () => {
        // Extract only the property declarations within the badge-overlay block
        const declarations = block
            .split('\n')
            .filter((line) => line.includes('color:') && line.includes('.badge-overlay'));
        expect(declarations.length).toBeGreaterThan(0);
        for (const decl of declarations) {
            expect(decl).not.toContain('!important');
        }
    });

    it('badge-overlay rules do NOT use !important on background-color property', () => {
        const declarations = block
            .split('\n')
            .filter((line) => line.includes('background-color:') && line.includes('.badge-overlay'));
        expect(declarations.length).toBeGreaterThan(0);
        for (const decl of declarations) {
            expect(decl).not.toContain('!important');
        }
    });

    it('badge-overlay rules do NOT use !important on border-color property', () => {
        const declarations = block
            .split('\n')
            .filter((line) => line.includes('border-color:') && line.includes('.badge-overlay'));
        expect(declarations.length).toBeGreaterThan(0);
        for (const decl of declarations) {
            expect(decl).not.toContain('!important');
        }
    });

    it('badge-overlay rules contain zero !important declarations overall', () => {
        // Strip multi-line comments, then check remaining rule lines for !important
        const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, '');
        const ruleLines = withoutComments
            .split('\n')
            .filter((line) => line.trim().length > 0);
        expect(ruleLines.length).toBeGreaterThan(0);
        for (const line of ruleLines) {
            expect(line).not.toContain('!important');
        }
    });

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
        const selectorLines = block
            .split('\n')
            .filter((line) => line.includes('.badge-overlay') && line.includes('{'));
        expect(selectorLines.length).toBeGreaterThan(0);
        for (const line of selectorLines) {
            expect(line).toContain('[data-scheme="light"]');
        }
    });
});
