/**
 * Unit tests for the token contrast maths behind the tinted-scheme guard
 * (ROK-1472). The browser half runs in light-contrast.smoke.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./base', () => ({ expect: vi.fn() }));

import { contrastRatio, parseColor, tokenContrastFailures } from './scheme-token-contrast';

describe('parseColor', () => {
    it('reads short hex, long hex and rgb()', () => {
        expect(parseColor('#fff')).toEqual([255, 255, 255]);
        expect(parseColor(' #7B9AB5 ')).toEqual([123, 154, 181]);
        expect(parseColor('rgb(4, 120, 87)')).toEqual([4, 120, 87]);
    });

    it('returns null for a value it cannot read', () => {
        expect(parseColor('')).toBeNull();
        expect(parseColor('var(--x)')).toBeNull();
    });
});

describe('contrastRatio', () => {
    it('matches the WCAG reference values', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBe(21);
        expect(contrastRatio('#ffffff', '#009966')).toBe(3.65);
        // default-light --color-dim on surface / panel, as index.css documents them.
        expect(contrastRatio('#5a697f', '#ffffff')).toBe(5.58);
        expect(contrastRatio('#5a697f', '#f1f5f9')).toBe(5.1);
    });

    it('throws naming a colour it cannot read', () => {
        expect(() => contrastRatio('#fff', 'nope')).toThrow('unparseable colour: nope');
    });
});

describe('tokenContrastFailures', () => {
    const backgrounds = ['--color-surface', '--color-panel'];

    it('reports one line per background the text token misses', () => {
        const tokens = { '--color-dim': '#7B9AB5', '--color-surface': '#FFFFFF', '--color-panel': '#E8F0F7' };
        expect(tokenContrastFailures(tokens, '--color-dim', backgrounds)).toEqual([
            '--color-dim #7B9AB5 on --color-surface #FFFFFF = 2.94:1 (needs 4.5:1)',
            '--color-dim #7B9AB5 on --color-panel #E8F0F7 = 2.56:1 (needs 4.5:1)',
        ]);
    });

    it('is empty when every pair reaches the minimum', () => {
        const tokens = { '--color-dim': '#5a697f', '--color-surface': '#ffffff', '--color-panel': '#f1f5f9' };
        expect(tokenContrastFailures(tokens, '--color-dim', backgrounds)).toEqual([]);
    });
});
