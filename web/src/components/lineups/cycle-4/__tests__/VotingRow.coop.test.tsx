/**
 * Failing-first component tests for the VotingRow co-op fit badge (ROK-1401).
 *
 * ── Contracts this spec PRESCRIBES ───────────────────────────────────
 *  - `LineupEntryResponseDto.cooptimusOnlineMax: number | null` (additive on
 *    `LineupEntryResponseSchema`). Setting it in the factory below is a TS
 *    error until the contract ships — fails-by-construction.
 *  - VotingRow renders `<span data-testid="coop-fit-badge">` carrying the
 *    label from `coopFitLabel(entry.cooptimusOnlineMax, voterDenominator)`.
 *  - When that helper returns null the row renders NO element with that
 *    testid at all — not an empty span, not a hidden placeholder. "No layout
 *    hole" is the operator's dormancy requirement: pre-activation, the row
 *    must be pixel-identical to main.
 *
 * ── Denominator ──────────────────────────────────────────────────────
 * Voting phase compares against `voterDenominator` — the prop already wired
 * to `lineup.votingEligibleCount` (ROK-1298). The badge must NOT invent its
 * own denominator from `voteCount`, `totalMembers`, or `ownerCount`.
 *
 * The compact badge carries NO attribution credit — that lives on the
 * credited surface (/games/:id, ROK-1398/1399), one tap away via the cover
 * thumbnail. See the ROK-1401 spec §Attribution.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { VotingRow } from '../VotingRow';

const BADGE = 'coop-fit-badge';

function makeEntry(
    overrides: Partial<LineupEntryResponseDto> = {},
): LineupEntryResponseDto {
    return {
        id: 1,
        gameId: 42,
        gameName: 'Deep Rock Galactic',
        gameCoverUrl: null,
        nominatedBy: { id: 1, displayName: 'Admin' },
        note: null,
        carriedOver: false,
        voteCount: 1,
        createdAt: '2026-08-21T00:00:00.000Z',
        ownerCount: 8,
        totalMembers: 12,
        nonOwnerCount: 4,
        wishlistCount: 0,
        itadCurrentPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        playerCount: null,
        cooptimusOnlineMax: null,
        ...overrides,
    };
}

type RowProps = Parameters<typeof VotingRow>[0];

function rowProps(props: Partial<RowProps> = {}): RowProps {
    return {
        entry: makeEntry(),
        isVoted: false,
        disabled: false,
        voterDenominator: 4,
        onToggleVote: vi.fn(),
        onOpenDrawer: vi.fn(),
        ...props,
    };
}

function renderRow(props: Partial<RowProps> = {}) {
    return renderWithProviders(<VotingRow {...rowProps(props)} />);
}

/**
 * Render a row that DOES show the badge, assert it, then re-render with the
 * absent-data variant and assert it is gone.
 *
 * The control render is deliberate: a bare `queryByTestId(...).toBeNull()`
 * passes vacuously today (nothing renders the testid yet) and would let a
 * broken implementation through. Pairing it with a positive control makes
 * the test fail now AND keeps it a real "no placeholder element" guard once
 * the badge ships.
 */
function expectBadgeDisappears(absent: Partial<RowProps>) {
    const { rerender } = renderRow({
        entry: makeEntry({ cooptimusOnlineMax: 4 }),
        voterDenominator: 4,
    });
    expect(screen.getByTestId(BADGE)).toBeInTheDocument();
    rerender(<VotingRow {...rowProps(absent)} />);
    expect(screen.queryByTestId(BADGE)).toBeNull();
}

// ─────────────────────────────────────────────────────────────────────
// Badge PRESENT — positive cooptimus value
// ─────────────────────────────────────────────────────────────────────

describe('VotingRow co-op badge — present for a positive cooptimusOnlineMax', () => {
    it('renders "✓ fits N" when the cap covers the eligible voter pool', () => {
        renderRow({
            entry: makeEntry({ cooptimusOnlineMax: 8 }),
            voterDenominator: 4,
        });
        expect(screen.getByTestId(BADGE)).toHaveTextContent('✓ fits 4');
    });

    it('renders "✓ fits N" at the exact boundary (cap === denominator)', () => {
        renderRow({
            entry: makeEntry({ cooptimusOnlineMax: 4 }),
            voterDenominator: 4,
        });
        expect(screen.getByTestId(BADGE)).toHaveTextContent('✓ fits 4');
    });

    it('renders "⚠ M-player co-op" when the pool overflows the cap', () => {
        renderRow({
            entry: makeEntry({ cooptimusOnlineMax: 4 }),
            voterDenominator: 12,
        });
        expect(screen.getByTestId(BADGE)).toHaveTextContent('⚠ 4-player co-op');
    });

    it('compares against voterDenominator, NOT voteCount or totalMembers', () => {
        // Denominator 4 fits a cap of 4; voteCount 1 and totalMembers 40 are
        // decoys. If the row derived its own denominator this would warn.
        renderRow({
            entry: makeEntry({
                cooptimusOnlineMax: 4,
                voteCount: 1,
                totalMembers: 40,
                ownerCount: 30,
            }),
            voterDenominator: 4,
        });
        const badge = screen.getByTestId(BADGE);
        expect(badge).toHaveTextContent('✓ fits 4');
        expect(badge).not.toHaveTextContent('40');
    });

    it('carries no attribution credit on the compact badge', () => {
        // The credit belongs on the credited surface (/games/:id), not on
        // every leaderboard row — same division as ROK-1399.
        renderRow({
            entry: makeEntry({ cooptimusOnlineMax: 8 }),
            voterDenominator: 4,
        });
        expect(screen.getByTestId(BADGE)).toBeInTheDocument();
        expect(screen.queryByTestId('cooptimus-credit')).toBeNull();
        expect(screen.queryByText(/co-op data from co-optimus/i)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────
// Badge ABSENT — dormant pre-activation, no layout hole
// ─────────────────────────────────────────────────────────────────────

describe('VotingRow co-op badge — absent, with no placeholder element', () => {
    it('renders NO badge element when cooptimusOnlineMax is null', () => {
        expectBadgeDisappears({
            entry: makeEntry({ cooptimusOnlineMax: null }),
            voterDenominator: 4,
        });
    });

    it('renders NO badge element when cooptimusOnlineMax is 0 (synced, no co-op)', () => {
        expectBadgeDisappears({
            entry: makeEntry({ cooptimusOnlineMax: 0 }),
            voterDenominator: 4,
        });
    });

    it('renders NO badge element when the denominator is 0', () => {
        expectBadgeDisappears({
            entry: makeEntry({ cooptimusOnlineMax: 4 }),
            voterDenominator: 0,
        });
    });

    it('never falls back to IGDB playerCount for the co-op claim', () => {
        // A 100-player IGDB lobby is not a co-op capability. With no
        // Co-Optimus data the row must stay silent.
        expectBadgeDisappears({
            entry: makeEntry({
                cooptimusOnlineMax: null,
                playerCount: { min: 1, max: 100 },
            }),
            voterDenominator: 4,
        });
        expect(screen.queryByText(/fits/i)).toBeNull();
        expect(screen.queryByText(/100/)).toBeNull();
    });

    it('leaves the rest of the row untouched when the badge is absent', () => {
        // Dormancy guard: the vote toggle, the game name and the X/N label
        // all still render exactly as before.
        expectBadgeDisappears({
            entry: makeEntry({
                gameName: 'Valheim',
                voteCount: 1,
                cooptimusOnlineMax: null,
            }),
            voterDenominator: 12,
        });
        expect(
            screen.getByRole('button', { name: 'Vote for Valheim' }),
        ).toBeInTheDocument();
        expect(screen.getByText('Valheim')).toBeInTheDocument();
        expect(screen.getByText('1/12')).toBeInTheDocument();
    });
});
