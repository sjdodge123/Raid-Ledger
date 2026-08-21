/**
 * Failing-first component tests for the MatchCard co-op capability badge
 * (ROK-1401).
 *
 * ── Contracts this spec PRESCRIBES ───────────────────────────────────
 *  - `MatchDetailResponseDto.cooptimusOnlineMax: number | null` (additive on
 *    `MatchDetailResponseSchema`, alongside — NOT replacing — the ROK-1411
 *    `playerCap`). Setting it in the factory is a TS error until the contract
 *    ships: fails-by-construction.
 *  - MatchCard renders `<span data-testid="coop-fit-badge">` from
 *    `coopFitLabel(match.cooptimusOnlineMax, match.members.length)` — the
 *    SAME helper VotingRow uses, so the copy lives in one place.
 *  - Absent data ⇒ no element with that testid, and the existing sub-line /
 *    CTA render untouched (dormancy).
 *
 * ── Why members.length and not fitType ───────────────────────────────
 * The persisted `fitType` is a snapshot taken at decide time. Bandwagon joins
 * (ROK-937) grow `members` afterwards, so a badge driven off `fitType` goes
 * stale and keeps claiming "fits" for a group that has outgrown the game.
 * The badge MUST recompute from the live member array on every render — the
 * "bandwagon" test below is the canonical guard: only `members` changes and
 * the badge must flip ✓ → ⚠ with no refetch and no other prop moving.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { MatchCard } from './MatchCard';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';

const BADGE = 'coop-fit-badge';

function makeMember(
    id: number,
): MatchDetailResponseDto['members'][number] {
    return {
        id,
        matchId: 1,
        userId: 100 + id,
        source: 'voted',
        createdAt: '2026-08-21T00:00:00Z',
        displayName: `Member ${id}`,
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
        schedulingSubmittedAt: null,
    };
}

/** N members, ids 1..N. */
function members(count: number): MatchDetailResponseDto['members'] {
    return Array.from({ length: count }, (_, i) => makeMember(i + 1));
}

function makeMatch(
    overrides: Partial<MatchDetailResponseDto> = {},
): MatchDetailResponseDto {
    return {
        id: 7,
        lineupId: 11,
        gameId: 42,
        gameName: 'Deep Rock Galactic',
        gameCoverUrl: null,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 4,
        votePercentage: 60,
        fitType: 'perfect',
        linkedEventId: null,
        playerCap: null,
        cooptimusOnlineMax: null,
        createdAt: '2026-08-21T00:00:00Z',
        updatedAt: '2026-08-21T00:00:00Z',
        members: members(1),
        ...overrides,
    };
}

function card(match: MatchDetailResponseDto) {
    return (
        <MatchCard
            match={match}
            lineupId={match.lineupId}
            isPersonal={true}
            schedulingEnabled={true}
        />
    );
}

function renderCard(match: MatchDetailResponseDto) {
    return renderWithProviders(card(match));
}

/**
 * Render a card that DOES show the badge, assert it, then re-render with the
 * absent-data variant and assert it is gone.
 *
 * The control render is deliberate: a bare `queryByTestId(...).toBeNull()`
 * passes vacuously today (nothing renders the testid yet) and would let a
 * broken implementation through. Pairing it with a positive control makes the
 * test fail now AND keeps it a real "no placeholder element" guard once the
 * badge ships.
 */
function expectBadgeDisappears(absent: MatchDetailResponseDto) {
    const { rerender } = renderCard(
        makeMatch({ cooptimusOnlineMax: 4, members: members(2) }),
    );
    expect(screen.getByTestId(BADGE)).toBeInTheDocument();
    rerender(card(absent));
    expect(screen.queryByTestId(BADGE)).toBeNull();
}

// ─────────────────────────────────────────────────────────────────────
// Badge PRESENT — vs the LIVE member count
// ─────────────────────────────────────────────────────────────────────

describe('MatchCard co-op badge — present for a positive cooptimusOnlineMax', () => {
    it('renders "✓ fits N" when the cap covers the current members', () => {
        renderCard(makeMatch({ cooptimusOnlineMax: 8, members: members(3) }));
        expect(screen.getByTestId(BADGE)).toHaveTextContent('✓ fits 3');
    });

    it('renders "✓ fits N" at the exact boundary (cap === members.length)', () => {
        renderCard(makeMatch({ cooptimusOnlineMax: 4, members: members(4) }));
        expect(screen.getByTestId(BADGE)).toHaveTextContent('✓ fits 4');
    });

    it('renders "⚠ M-player co-op" when the group has outgrown the cap', () => {
        renderCard(makeMatch({ cooptimusOnlineMax: 4, members: members(6) }));
        expect(screen.getByTestId(BADGE)).toHaveTextContent('⚠ 4-player co-op');
    });

    it('ignores the persisted fitType snapshot', () => {
        // fitType says 'perfect' (true at decide time); members have since
        // grown to 9 against a cap of 4. The live count wins.
        renderCard(
            makeMatch({
                cooptimusOnlineMax: 4,
                fitType: 'perfect',
                members: members(9),
            }),
        );
        expect(screen.getByTestId(BADGE)).toHaveTextContent('⚠ 4-player co-op');
    });

    it('coexists with the ROK-1411 "X of Y players" sub-line', () => {
        // Both signals ship: playerCap answers capacity, the badge answers
        // co-op capability. Neither replaces the other.
        renderCard(
            makeMatch({
                cooptimusOnlineMax: 4,
                playerCap: 4,
                members: members(2),
            }),
        );
        expect(screen.getByText(/2 of 4 players/i)).toBeInTheDocument();
        expect(screen.getByTestId(BADGE)).toHaveTextContent('✓ fits 2');
    });

    it('carries no attribution credit on the compact badge', () => {
        // The credit belongs on the credited surface (/games/:id), not on
        // every match card — same division as ROK-1399.
        renderCard(makeMatch({ cooptimusOnlineMax: 8, members: members(2) }));
        expect(screen.getByTestId(BADGE)).toBeInTheDocument();
        expect(screen.queryByTestId('cooptimus-credit')).toBeNull();
        expect(screen.queryByText(/co-op data from co-optimus/i)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────
// Bandwagon recompute — ONLY `members` changes
// ─────────────────────────────────────────────────────────────────────

describe('MatchCard co-op badge — bandwagon recompute', () => {
    it('flips ✓ → ⚠ when members grow past the cap, with no other prop changing', () => {
        const base = makeMatch({ cooptimusOnlineMax: 4, members: members(4) });
        const { rerender } = renderCard(base);
        expect(screen.getByTestId(BADGE)).toHaveTextContent('✓ fits 4');

        // A bandwagon join adds one member. Everything else — including the
        // stale `fitType` and `playerCap` — is byte-identical.
        const grown: MatchDetailResponseDto = { ...base, members: members(5) };
        rerender(
            <MatchCard
                match={grown}
                lineupId={grown.lineupId}
                isPersonal={true}
                schedulingEnabled={true}
            />,
        );
        expect(screen.getByTestId(BADGE)).toHaveTextContent('⚠ 4-player co-op');
    });

    it('flips ⚠ → ✓ when a member leaves and the group fits again', () => {
        const base = makeMatch({ cooptimusOnlineMax: 4, members: members(5) });
        const { rerender } = renderCard(base);
        expect(screen.getByTestId(BADGE)).toHaveTextContent('⚠ 4-player co-op');

        const shrunk: MatchDetailResponseDto = { ...base, members: members(3) };
        rerender(
            <MatchCard
                match={shrunk}
                lineupId={shrunk.lineupId}
                isPersonal={true}
                schedulingEnabled={true}
            />,
        );
        expect(screen.getByTestId(BADGE)).toHaveTextContent('✓ fits 3');
    });
});

// ─────────────────────────────────────────────────────────────────────
// Badge ABSENT — dormant, no layout hole
// ─────────────────────────────────────────────────────────────────────

describe('MatchCard co-op badge — absent, with no placeholder element', () => {
    it('renders NO badge element when cooptimusOnlineMax is null', () => {
        expectBadgeDisappears(
            makeMatch({ cooptimusOnlineMax: null, members: members(3) }),
        );
    });

    it('renders NO badge element when cooptimusOnlineMax is 0', () => {
        expectBadgeDisappears(
            makeMatch({ cooptimusOnlineMax: 0, members: members(3) }),
        );
    });

    it('renders NO badge element when the match has no members yet', () => {
        expectBadgeDisappears(
            makeMatch({ cooptimusOnlineMax: 4, members: [] }),
        );
    });

    it('never falls back to playerCap or IGDB for the co-op claim', () => {
        // playerCap 100 is a lobby size resolved from IGDB. It must not
        // manufacture a co-op badge.
        expectBadgeDisappears(
            makeMatch({
                cooptimusOnlineMax: null,
                playerCap: 100,
                members: members(3),
            }),
        );
        expect(screen.queryByText(/fits/i)).toBeNull();
        expect(screen.queryByText(/player co-op/i)).toBeNull();
    });

    it('leaves the sub-line and CTA untouched when the badge is absent', () => {
        expectBadgeDisappears(
            makeMatch({
                cooptimusOnlineMax: null,
                playerCap: 10,
                members: members(3),
                linkedEventId: null,
            }),
        );
        expect(screen.getByText(/3 of 10 players/i)).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: /pick a time/i }),
        ).toBeInTheDocument();
    });
});
