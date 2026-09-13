/**
 * ROK-1539 — the design-system reference page must mount and must keep every
 * section. A section silently disappearing is how a reference page rots into
 * a lie, so each heading is asserted by name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { DesignSystemPage } from './DesignSystemPage';

const mockUseSystemStatus = vi.fn();
vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => mockUseSystemStatus(),
}));

function demoMode(enabled: boolean): void {
    mockUseSystemStatus.mockReturnValue({ data: { demoMode: enabled }, isLoading: false });
}

describe('DesignSystemPage', () => {
    beforeEach(() => {
        mockUseSystemStatus.mockReset();
    });

    it('renders the page header when DEMO_MODE is on', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.getByRole('heading', { name: /Raid Ledger — Design System/i, level: 1 })).toBeInTheDocument();
    });

    it.each([
        'Tokens',
        'Primitives — badges, chips, buttons, inputs, states',
        'Overlays and containers',
        'Pattern — filtering',
    ])('renders the "%s" section heading', (heading) => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.getByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
    });

    it('shows the filtering DO and DON\'T side by side', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.getByTestId('ds-filter-do')).toBeInTheDocument();
        expect(screen.getByTestId('ds-filter-dont')).toBeInTheDocument();
        // The canonical panel owns "Clear all"; the bespoke copy has no such control.
        expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument();
    });

    it('renders token swatches for the surface roles', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        for (const token of ['--color-backdrop', '--color-surface', '--color-panel', '--color-foreground', '--color-edge']) {
            expect(screen.getByTestId(`swatch-live-${token}`)).toBeInTheDocument();
        }
    });

    it('renders nothing while system status is still loading', () => {
        mockUseSystemStatus.mockReturnValue({ data: undefined, isLoading: true });
        const { container } = renderWithProviders(<DesignSystemPage />);
        expect(container).toBeEmptyDOMElement();
    });

    it('redirects away when DEMO_MODE is off', () => {
        demoMode(false);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.queryByRole('heading', { name: /Raid Ledger — Design System/i })).not.toBeInTheDocument();
    });
});
