import { describe, it, expect } from 'vitest';
import { brandLabelFor, BRAND_LABEL_HEX } from './brand-label';
import { contrastRatio } from '../styles/wcag-contrast';

describe('brandLabelFor — label colour by WCAG contrast (ROK-1472)', () => {
    it.each([
        ['#5865F2', 'light'], // Discord blurple
        ['#10b981', 'dark'], // emerald-500
        ['#f59e0b', 'dark'], // amber-500
        ['#7c3aed', 'light'], // violet-600
        ['#ffffff', 'dark'],
        ['#000', 'light'],
    ] as const)('%s → %s', (fill, expected) => {
        expect(brandLabelFor(fill), `label on ${fill}`).toBe(expected);
    });

    it('always picks the label with the higher contrast', () => {
        for (const fill of ['#5865F2', '#10b981', '#f59e0b', '#7c3aed', '#24292e', '#ff4500']) {
            const chosen = BRAND_LABEL_HEX[brandLabelFor(fill)];
            const other = BRAND_LABEL_HEX[brandLabelFor(fill) === 'dark' ? 'light' : 'dark'];
            expect(contrastRatio(fill, chosen), `${fill}: chosen ${chosen} must beat ${other}`)
                .toBeGreaterThanOrEqual(contrastRatio(fill, other));
        }
    });

    it('keeps the white label for a value that is not a hex colour', () => {
        expect(brandLabelFor('rebeccapurple')).toBe('light');
        expect(brandLabelFor('rgb(16, 185, 129)')).toBe('light');
    });
});
