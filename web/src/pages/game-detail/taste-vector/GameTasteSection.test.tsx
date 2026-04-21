/**
 * Unit tests for GameTasteSection (ROK-1082).
 *
 * Written TDD-style BEFORE the component is implemented — every test
 * here must FAIL on first run. The dev agent builds to make them pass.
 *
 * Mirrors `TasteProfileSection.test.tsx` shape (mock the data hook,
 * assert on rendered states).
 *
 * States covered:
 *  - loading → loading indicator
 *  - error → error message
 *  - empty (confidence === 0) → "not enough data" placeholder, NOT the chart
 *  - populated (confidence > 0) → <h2>Taste Profile</h2>, radar chart,
 *    axis breakdown list
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
// @ts-expect-error — contract type does not exist yet (ROK-1082 TDD)
import type { GameTasteProfileResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
// @ts-expect-error — component does not exist yet (ROK-1082 TDD)
import { GameTasteSection } from './GameTasteSection';

const mockUseGameTasteProfile = vi.fn();

vi.mock('../../../hooks/use-game-taste-profile', () => ({
    useGameTasteProfile: (...args: unknown[]) => mockUseGameTasteProfile(...args),
}));

function makeResult(
    overrides?: Partial<UseQueryResult<GameTasteProfileResponseDto, Error>>,
): UseQueryResult<GameTasteProfileResponseDto, Error> {
    return {
        data: undefined,
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPending: false,
        isFetching: false,
        error: null,
        status: 'success',
        refetch: vi.fn(),
        ...overrides,
    } as unknown as UseQueryResult<GameTasteProfileResponseDto, Error>;
}

function makeProfile(
    overrides?: Partial<GameTasteProfileResponseDto>,
): GameTasteProfileResponseDto {
    return {
        gameId: 42,
        vector: [0.2, 0.1, 0.9, 0.1, 0.3, 0.1, 0.1],
        dimensions: {
            co_op: 20,
            pvp: 10,
            rpg: 90,
            survival: 10,
            strategy: 30,
            social: 10,
            mmo: 5,
        } as unknown as GameTasteProfileResponseDto['dimensions'],
        confidence: 0.7,
        computedAt: '2026-04-20T00:00:00.000Z',
        ...overrides,
    } as GameTasteProfileResponseDto;
}

beforeEach(() => {
    mockUseGameTasteProfile.mockReset();
});

describe('<GameTasteSection> — loading state', () => {
    it('renders a loading indicator while the query is pending', () => {
        mockUseGameTasteProfile.mockReturnValue(
            makeResult({
                isLoading: true,
                data: undefined,
                isSuccess: false,
                status: 'pending',
            }),
        );
        renderWithProviders(<GameTasteSection gameId={42} />);
        expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    });
});

describe('<GameTasteSection> — error state', () => {
    it('renders an error message when the query fails', () => {
        mockUseGameTasteProfile.mockReturnValue(
            makeResult({
                isError: true,
                isLoading: false,
                data: undefined,
                error: new Error('boom'),
                status: 'error',
            }),
        );
        renderWithProviders(<GameTasteSection gameId={42} />);
        // Loading indicator MUST NOT be shown on error
        expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
        // Some visible affordance indicating failure
        expect(
            screen.getByText(/error|failed|unavailable|not enough/i),
        ).toBeInTheDocument();
    });
});

describe('<GameTasteSection> — empty state (confidence === 0)', () => {
    it('renders a "not enough data" placeholder and suppresses the radar chart', () => {
        const profile = makeProfile({
            confidence: 0,
            vector: [0, 0, 0, 0, 0, 0, 0],
            dimensions: {
                co_op: 0,
                pvp: 0,
                rpg: 0,
                survival: 0,
                strategy: 0,
                social: 0,
                mmo: 0,
            } as unknown as GameTasteProfileResponseDto['dimensions'],
        });
        mockUseGameTasteProfile.mockReturnValue(
            makeResult({ data: profile, isLoading: false }),
        );
        renderWithProviders(<GameTasteSection gameId={42} />);
        expect(
            screen.getByText(/not enough data/i),
        ).toBeInTheDocument();
        // The radar chart (reused from ROK-948 as `TasteRadarChart` or a
        // game-specific parallel) renders an SVG with role "img". Assert
        // that NO radar chart is on the page in the empty state.
        expect(
            screen.queryByTestId('game-radar-chart'),
        ).not.toBeInTheDocument();
    });
});

describe('<GameTasteSection> — populated state (confidence > 0)', () => {
    it('renders the Taste Profile heading, radar chart, and axis breakdown list', () => {
        const profile = makeProfile();
        mockUseGameTasteProfile.mockReturnValue(
            makeResult({ data: profile, isLoading: false }),
        );
        renderWithProviders(<GameTasteSection gameId={42} />);

        // Heading
        expect(
            screen.getByRole('heading', { name: /Taste Profile/i }),
        ).toBeInTheDocument();
        // Radar chart present
        expect(
            screen.getByTestId('game-radar-chart'),
        ).toBeInTheDocument();
        // Axis breakdown list present
        expect(
            screen.getByTestId('axis-breakdown'),
        ).toBeInTheDocument();
    });
});
