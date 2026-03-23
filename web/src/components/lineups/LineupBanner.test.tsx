/**
 * Tests for LineupBanner (ROK-935).
 * Validates banner rendering states: loading, no data, and populated.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockBanner } from '../../test/lineup-factories';
import { LineupBanner } from './LineupBanner';

// Mock the hooks module
vi.mock('../../hooks/use-lineups', () => ({
    useLineupBanner: vi.fn(),
}));

// Mock NominateModal to avoid its internal hook dependencies
vi.mock('./NominateModal', () => ({
    NominateModal: () => null,
}));

import { useLineupBanner } from '../../hooks/use-lineups';

const mockUseLineupBanner = vi.mocked(useLineupBanner);

function mockHookReturn(data: ReturnType<typeof createMockBanner> | null | undefined, isLoading = false) {
    mockUseLineupBanner.mockReturnValue({
        data: data ?? undefined,
        isLoading,
        isSuccess: !isLoading && data !== undefined,
        isError: false,
        error: null,
        isFetching: isLoading,
        // Minimal query result fields
    } as ReturnType<typeof useLineupBanner>);
}

describe('LineupBanner — loading state', () => {
    it('renders skeleton when loading', () => {
        mockHookReturn(undefined, true);
        const { container } = renderWithProviders(<LineupBanner />);
        expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });
});

describe('LineupBanner — no data', () => {
    it('renders nothing when data is null', () => {
        mockHookReturn(null);
        const { container } = renderWithProviders(<LineupBanner />);
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when data is undefined', () => {
        mockHookReturn(undefined);
        const { container } = renderWithProviders(<LineupBanner />);
        // Either empty or skeleton depending on loading state
        expect(container.textContent).toBe('');
    });
});

describe('LineupBanner — populated state', () => {
    it('renders "COMMUNITY LINEUP" header text', () => {
        mockHookReturn(createMockBanner());
        renderWithProviders(<LineupBanner />);
        expect(screen.getByText('COMMUNITY LINEUP')).toBeInTheDocument();
    });

    it('renders the lineup question heading', () => {
        mockHookReturn(createMockBanner());
        renderWithProviders(<LineupBanner />);
        expect(screen.getByText(/what are we playing/i)).toBeInTheDocument();
    });

    it('renders the lineup status badge', () => {
        mockHookReturn(createMockBanner({ status: 'building' }));
        renderWithProviders(<LineupBanner />);
        expect(screen.getByText('Nominating')).toBeInTheDocument();
    });

    it('displays entry count and voter stats', () => {
        mockHookReturn(createMockBanner({ entryCount: 5, totalVoters: 3, totalMembers: 10 }));
        renderWithProviders(<LineupBanner />);
        expect(screen.getByText(/5 games nominated/)).toBeInTheDocument();
        expect(screen.getByText(/3 of 10 members voted/)).toBeInTheDocument();
    });

    it('renders game thumbnail images', () => {
        const banner = createMockBanner();
        mockHookReturn(banner);
        renderWithProviders(<LineupBanner />);
        const images = screen.getAllByRole('img');
        expect(images.length).toBeGreaterThanOrEqual(2);
    });

    it('renders "View Lineup & Vote" link', () => {
        mockHookReturn(createMockBanner({ id: 42 }));
        renderWithProviders(<LineupBanner />);
        const link = screen.getByRole('link', { name: /view lineup/i });
        expect(link).toHaveAttribute('href', '/community-lineup/42');
    });

    it('renders "Nominate" button', () => {
        mockHookReturn(createMockBanner());
        renderWithProviders(<LineupBanner />);
        expect(screen.getByRole('button', { name: /nominate/i })).toBeInTheDocument();
    });

    it('formats target date when present', () => {
        mockHookReturn(createMockBanner({ targetDate: '2026-03-28' }));
        renderWithProviders(<LineupBanner />);
        // Should render a formatted date string
        expect(screen.getByText(/mar/i)).toBeInTheDocument();
    });
});
