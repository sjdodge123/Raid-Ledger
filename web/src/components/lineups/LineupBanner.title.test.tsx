/**
 * ROK-1063 — failing TDD tests for the LineupBanner title.
 *
 * The banner must show the lineup's stored `title` prominently so
 * members can tell lineups apart at a glance.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockBanner } from '../../test/lineup-factories';
import { LineupBanner } from './LineupBanner';

vi.mock('../../hooks/use-lineups', () => ({
    useLineupBanner: vi.fn(),
}));

vi.mock('./NominateModal', () => ({
    NominateModal: () => null,
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ user: null }),
    isOperatorOrAdmin: () => false,
}));

import { useLineupBanner } from '../../hooks/use-lineups';

const mockUseLineupBanner = vi.mocked(useLineupBanner);

function mockBannerWithTitle(title: string) {
    const data = createMockBanner();
    const withTitle = { ...data, title } as typeof data & { title: string };
    mockUseLineupBanner.mockReturnValue({
        data: withTitle,
        isLoading: false,
        isSuccess: true,
        isError: false,
        error: null,
        isFetching: false,
    } as unknown as ReturnType<typeof useLineupBanner>);
}

describe('LineupBanner — title (ROK-1063)', () => {
    it('renders the lineup title prominently in the banner', () => {
        mockBannerWithTitle('Summer Kick-off Raid');
        renderWithProviders(<LineupBanner />);

        expect(
            screen.getByText(/Summer Kick-off Raid/),
        ).toBeInTheDocument();
    });
});
