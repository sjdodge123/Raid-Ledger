import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AA_SMALL_TEXT, contrastRatio, stripComments } from './wcag-contrast';

/**
 * ROK-1942 — `--color-media-well` is the photo / video stage and is near-black in
 * EVERY scheme (operator ruling: a dark image area). It is declared once in `@theme`
 * and no scheme block may remap it; its foreground stays AA on it.
 */
const css = stripComments(readFileSync(resolve(__dirname, '../index.css'), 'utf-8'));
const decls = (name: string): string[] =>
    [...css.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))].map((m) => m[1] ?? '');

describe('media-well tokens (ROK-1942)', () => {
    it('each is declared exactly once (never remapped by a scheme)', () => {
        expect(decls('--color-media-well')).toHaveLength(1);
        expect(decls('--color-media-well-foreground')).toHaveLength(1);
    });

    it('the foreground reads at AA on the well', () => {
        const [well] = decls('--color-media-well');
        const [fg] = decls('--color-media-well-foreground');
        expect(contrastRatio(fg ?? '', well ?? '')).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
});
