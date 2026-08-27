/**
 * Failing-first tests for the VotingLeaderboardV2 "fits our group" sort
 * assist (ROK-1401 §2e — the deferred item).
 *
 * The control is deliberately DORMANT until Co-Optimus data exists: with an
 * un-synced library the leaderboard must render exactly as it does today,
 * with no header, no toggle and no reserved space. This mirrors the
 * "fully dormant pre-activation" rule the rest of ROK-1401 already follows.
 *
 * It is also an ASSIST, not a filter — flipping it re-orders the same rows
 * and never hides one. The operator's 2026-08-21 scope pivot removed
 * per-row fit BADGES from VotingRow; this adds no badge back, only an
 * opt-in ordering control that defaults to off.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { VotingLeaderboardV2 } from '../VotingLeaderboardV2';

function makeEntry(
    overrides: Partial<LineupEntryResponseDto> = {},
): LineupEntryResponseDto {
    return {
        id: 1,
        gameId: 42,
        gameName: 'Valheim',
        gameCoverUrl: null,
        nominatedBy: { id: 1, displayName: 'Admin' },
        note: null,
        carriedOver: false,
        voteCount: 1,
        createdAt: '2026-05-15T00:00:00.000Z',
        ownerCount: 8,
        totalMembers: 12,
        nonOwnerCount: 4,
        wishlistCount: 0,
        itadCurrentPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        playerCount: null,
        ...overrides,
    };
}

/** Two co-op games (one fits 6, one doesn't) + one un-synced game. */
const SYNCED_ENTRIES: LineupEntryResponseDto[] = [
    makeEntry({
        id: 1,
        gameId: 1,
        gameName: 'Deep Rock',
        voteCount: 5,
        cooptimusOnlineMax: 4,
    }),
    makeEntry({
        id: 2,
        gameId: 2,
        gameName: 'Destiny 2',
        voteCount: 3,
        cooptimusOnlineMax: 6,
    }),
    makeEntry({
        id: 3,
        gameId: 3,
        gameName: 'Counter-Strike',
        voteCount: 9,
        cooptimusOnlineMax: null,
    }),
];

function renderBoard(
    props: Partial<Parameters<typeof VotingLeaderboardV2>[0]> = {},
) {
    const defaults = {
        entries: SYNCED_ENTRIES,
        myVotes: [],
        voterDenominator: 6,
        atLimit: false,
        canParticipate: true,
        onToggleVote: vi.fn(),
        onOpenDrawer: vi.fn(),
        ...props,
    };
    return renderWithProviders(<VotingLeaderboardV2 {...defaults} />);
}

/** Row order, read off the per-row vote toggle's accessible name. */
function renderedOrder(): string[] {
    return screen
        .getAllByTestId('vote-toggle')
        .map((el) => el.getAttribute('aria-label') ?? '');
}

// ─────────────────────────────────────────────────────────────────────
// Dormancy — no data, no control, no layout change
// ─────────────────────────────────────────────────────────────────────

describe('VotingLeaderboardV2 — sort assist dormancy', () => {
    it('renders no sort control when no entry has Co-Optimus data', () => {
        renderBoard({
            entries: [
                makeEntry({ id: 1, gameId: 1, cooptimusOnlineMax: null }),
                makeEntry({ id: 2, gameId: 2, cooptimusOnlineMax: 0 }),
            ],
        });
        expect(
            screen.queryByTestId('coop-fit-sort-toggle'),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByTestId('voting-leaderboard-header'),
        ).not.toBeInTheDocument();
    });

    it('renders no sort control when the group size is unknown', () => {
        renderBoard({ voterDenominator: 0 });
        expect(
            screen.queryByTestId('coop-fit-sort-toggle'),
        ).not.toBeInTheDocument();
    });

    it('renders the control once any entry carries a positive online max', () => {
        renderBoard();
        expect(screen.getByTestId('coop-fit-sort-toggle')).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────
// Ordering
// ─────────────────────────────────────────────────────────────────────

describe('VotingLeaderboardV2 — sort assist ordering', () => {
    it('defaults to off — vote order is untouched', () => {
        renderBoard();
        expect(screen.getByTestId('coop-fit-sort-toggle')).toHaveAttribute(
            'aria-pressed',
            'false',
        );
        expect(renderedOrder()).toEqual([
            'Vote for Counter-Strike',
            'Vote for Deep Rock',
            'Vote for Destiny 2',
        ]);
    });

    it('floats games that fit the whole group when switched on', async () => {
        const user = userEvent.setup();
        renderBoard();
        await user.click(screen.getByTestId('coop-fit-sort-toggle'));
        expect(screen.getByTestId('coop-fit-sort-toggle')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        // Destiny 2 (6 >= 6) rises above higher-voted games that do not fit.
        expect(renderedOrder()).toEqual([
            'Vote for Destiny 2',
            'Vote for Counter-Strike',
            'Vote for Deep Rock',
        ]);
    });

    it('re-orders without ever hiding a row', async () => {
        const user = userEvent.setup();
        renderBoard();
        await user.click(screen.getByTestId('coop-fit-sort-toggle'));
        expect(screen.getAllByTestId('voting-row')).toHaveLength(
            SYNCED_ENTRIES.length,
        );
    });

    it('switches back to vote order when toggled off again', async () => {
        const user = userEvent.setup();
        renderBoard();
        const toggle = screen.getByTestId('coop-fit-sort-toggle');
        await user.click(toggle);
        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(renderedOrder()).toEqual([
            'Vote for Counter-Strike',
            'Vote for Deep Rock',
            'Vote for Destiny 2',
        ]);
    });

    it('names the group size in the control accessible name', () => {
        renderBoard();
        expect(
            screen.getByRole('button', {
                name: /fit all 6 players/i,
            }),
        ).toBeInTheDocument();
    });
});
