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
    useActiveLineups: vi.fn(() => ({ data: [], isLoading: false })),
}));

// Mock NominateModal to avoid its internal hook dependencies
vi.mock('./NominateModal', () => ({
    NominateModal: () => null,
}));

// Mock StartLineupModal — its internals (useCreateLineup, durations, etc.)
// are out of scope for banner-level role-gating tests.
vi.mock('./start-lineup-modal', () => ({
    StartLineupModal: () => null,
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({ user: null })),
    isOperatorOrAdmin: vi.fn(() => false),
}));

import { useLineupBanner } from '../../hooks/use-lineups';
import { isOperatorOrAdmin } from '../../hooks/use-auth';

const mockUseLineupBanner = vi.mocked(useLineupBanner);
const mockIsOperatorOrAdmin = vi.mocked(isOperatorOrAdmin);

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

    it('renders the lineup title heading (ROK-1063)', () => {
        mockHookReturn(createMockBanner({ title: 'Spring Kickoff' }));
        renderWithProviders(<LineupBanner />);
        expect(screen.getByText('Spring Kickoff')).toBeInTheDocument();
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

// ROK-1061: admin/operator-gated lineup creation. The "Start Lineup" CTA
// (no active lineup) and the "Start another lineup" button (active lineup
// present) must only render for users with operator or admin role.
describe('LineupBanner — role gating (ROK-1061)', () => {
    it('renders nothing when no banner and user lacks operator/admin role', () => {
        mockIsOperatorOrAdmin.mockReturnValue(false);
        mockHookReturn(null);
        const { container } = renderWithProviders(<LineupBanner />);
        expect(container.firstChild).toBeNull();
        expect(screen.queryByRole('button', { name: /start lineup/i })).not.toBeInTheDocument();
    });

    it('renders Start Lineup CTA when no banner and user is operator/admin', () => {
        mockIsOperatorOrAdmin.mockReturnValue(true);
        mockHookReturn(null);
        renderWithProviders(<LineupBanner />);
        expect(screen.getByRole('button', { name: /start lineup/i })).toBeInTheDocument();
    });

    it('hides "Start another lineup" button on populated banner for non-role users', () => {
        mockIsOperatorOrAdmin.mockReturnValue(false);
        mockHookReturn(createMockBanner());
        renderWithProviders(<LineupBanner />);
        expect(screen.queryByTestId('start-another-lineup')).not.toBeInTheDocument();
    });

    it('shows "Start another lineup" button on populated banner for operator/admin', () => {
        mockIsOperatorOrAdmin.mockReturnValue(true);
        mockHookReturn(createMockBanner());
        renderWithProviders(<LineupBanner />);
        expect(screen.getByTestId('start-another-lineup')).toBeInTheDocument();
    });
});
