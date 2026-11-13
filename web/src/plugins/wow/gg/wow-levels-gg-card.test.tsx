/** ROK-2187 — the WoW levels GG card reads singular for a count of one. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GgWowLevelsCardView } from './wow-levels-gg-card';

const main = { name: 'Thrall', className: 'Shaman', fromLevel: 10, maxLevel: 60, dings: 50 };

describe('GgWowLevelsCardView (ROK-2187)', () => {
    it('says "1 level dinged" and "1 ding" for counts of one', () => {
        render(<GgWowLevelsCardView year={2026} payload={{ totalDings: 1, characters: [{ ...main, dings: 1, fromLevel: 59 }, { name: 'Jaina', maxLevel: 12, dings: 1 }] }} />);
        expect(screen.getByText('1 level dinged')).toBeInTheDocument();
        expect(screen.getByText('1 ding')).toBeInTheDocument();
        expect(screen.queryByText(/1 levels|1 dings/)).toBeNull();
    });

    it('keeps the plural for counts above one', () => {
        render(<GgWowLevelsCardView year={2026} payload={{ totalDings: 53, characters: [main, { name: 'Jaina', maxLevel: 12, dings: 3 }] }} />);
        expect(screen.getByText('53 levels dinged')).toBeInTheDocument();
        expect(screen.getByText('3 dings')).toBeInTheDocument();
    });
});
