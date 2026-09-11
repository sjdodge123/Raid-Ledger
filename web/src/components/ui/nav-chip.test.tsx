/**
 * ROK-1101 TD-4. The two call sites this primitive replaced (OtherActiveLineups,
 * SchedulingBanner) had NO tests, so the extraction was otherwise unguarded —
 * these lock the contract the call sites depend on.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavChip, NAV_CHIP_CLASS } from './nav-chip';

function renderChip(ui: React.ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('NavChip', () => {
    it('renders a link to `to` carrying the shared chip class', () => {
        renderChip(
            <NavChip to="/community-lineup/7">
                <span>Tuesday night</span>
            </NavChip>,
        );

        const link = screen.getByRole('link', { name: 'Tuesday night' });
        expect(link).toHaveAttribute('href', '/community-lineup/7');
        // Pinned as a literal, not against NAV_CHIP_CLASS — comparing the
        // constant to itself would pass no matter what the constant said.
        // This is the look both call sites shipped with; changing it should
        // be a deliberate edit here too.
        expect(link).toHaveAttribute(
            'class',
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-overlay transition-colors text-sm',
        );
        expect(NAV_CHIP_CLASS).toBe(link.getAttribute('class'));
    });

    it('applies testId as data-testid when given', () => {
        renderChip(
            <NavChip to="/x" testId="other-lineup-chip-42">
                <span>chip</span>
            </NavChip>,
        );

        expect(screen.getByTestId('other-lineup-chip-42')).toBeInTheDocument();
    });

    it('omits data-testid entirely when testId is not given', () => {
        renderChip(
            <NavChip to="/x">
                <span>chip</span>
            </NavChip>,
        );

        expect(screen.getByRole('link')).not.toHaveAttribute('data-testid');
    });

    it('renders arbitrary children in order', () => {
        renderChip(
            <NavChip to="/x">
                <span>Halo</span>
                <span>3 slots</span>
                <span>Vote</span>
            </NavChip>,
        );

        expect(screen.getByRole('link').textContent).toBe('Halo3 slotsVote');
    });
});
