/**
 * Failing-first tests for VotingRow (ROK-1298, Sv Voting composite).
 *
 * Source file does not yet exist — these MUST fail with module-not-found
 * until the dev creates
 * `web/src/components/lineups/cycle-4/VotingRow.tsx`.
 *
 * Covered ACs (from docs/specs/rok-1298-sv-voting-composite.md
 * §"Behavior Specifications" + §"Test plan" / dev-brief AC table):
 *
 *  AC2 — Tapping the row body opens the U2 drawer (NOT the vote toggle).
 *  AC3 — Vote toggle has `aria-label="Vote for {gameName}"` + `aria-pressed`
 *        that reflects the current state. Canonical a11y fix.
 *  AC4 — Vote bars normalized to `voteCount / votingEligibleCount`
 *        (i.e. 1/12 ≈ 8%, NOT 100%). Canonical bug-fix regression guard.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { VotingRow } from '../VotingRow';

function makeEntry(
    overrides: Partial<LineupEntryResponseDto> = {},
): LineupEntryResponseDto {
    return {
        id: 1,
        gameId: 42,
        gameName: 'Valheim',
        gameCoverUrl: 'https://example.com/cover.jpg',
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

function renderRow(
    props: Partial<Parameters<typeof VotingRow>[0]> = {},
) {
    const defaults = {
        entry: makeEntry(),
        isVoted: false,
        disabled: false,
        voterDenominator: 12,
        onToggleVote: vi.fn(),
        onOpenDrawer: vi.fn(),
        ...props,
    };
    return renderWithProviders(<VotingRow {...defaults} />);
}

// ─────────────────────────────────────────────────────────────────────
// AC3 — Vote toggle accessible name + aria-pressed
// ─────────────────────────────────────────────────────────────────────

describe('VotingRow — a11y vote toggle (AC3)', () => {
    it('renders the vote toggle as a button with aria-label="Vote for {gameName}"', () => {
        renderRow({ entry: makeEntry({ gameName: 'Valheim' }) });
        const btn = screen.getByRole('button', { name: 'Vote for Valheim' });
        expect(btn).toBeInTheDocument();
    });

    it('aria-pressed="false" when isVoted=false', () => {
        renderRow({ isVoted: false });
        const btn = screen.getByRole('button', { name: /Vote for/ });
        expect(btn).toHaveAttribute('aria-pressed', 'false');
    });

    it('aria-pressed="true" when isVoted=true', () => {
        renderRow({ isVoted: true });
        const btn = screen.getByRole('button', { name: /Vote for/ });
        expect(btn).toHaveAttribute('aria-pressed', 'true');
    });

    it('uses the entry game name in the aria-label (not a hardcoded string)', () => {
        renderRow({ entry: makeEntry({ gameName: 'Helldivers 2' }) });
        expect(
            screen.getByRole('button', { name: 'Vote for Helldivers 2' }),
        ).toBeInTheDocument();
    });

    it('renders the cover thumbnail as the details trigger (ROK-1373)', () => {
        // ROK-1373: the row body no longer navigates; the cover thumbnail is
        // the explicit "view details" control. The vote button is separate.
        renderRow({ entry: makeEntry({ gameName: 'Valheim' }) });
        const opener = screen.getByRole('button', {
            name: /View details for Valheim/i,
        });
        expect(opener).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC2 — Click-bubbling guard: row body opens drawer; circle toggles
// ─────────────────────────────────────────────────────────────────────

describe('VotingRow — click-bubbling guard (AC2)', () => {
    it('clicking the vote toggle fires onToggleVote and NOT onOpenDrawer', async () => {
        const user = userEvent.setup();
        const onToggleVote = vi.fn();
        const onOpenDrawer = vi.fn();
        renderRow({ onToggleVote, onOpenDrawer });

        const voteBtn = screen.getByRole('button', { name: /Vote for/ });
        await user.click(voteBtn);

        expect(onToggleVote).toHaveBeenCalledTimes(1);
        // The vote button must call e.stopPropagation() so the drawer
        // trigger never fires — this is the spec's interaction matrix.
        expect(onOpenDrawer).not.toHaveBeenCalled();
    });

    it('clicking the cover thumbnail fires onOpenDrawer and NOT onToggleVote', async () => {
        const user = userEvent.setup();
        const onToggleVote = vi.fn();
        const onOpenDrawer = vi.fn();
        renderRow({ onToggleVote, onOpenDrawer });

        const opener = screen.getByRole('button', { name: /View details for/ });
        await user.click(opener);

        expect(onOpenDrawer).toHaveBeenCalledTimes(1);
        expect(onToggleVote).not.toHaveBeenCalled();
    });

    it('disabled vote toggle does NOT fire onToggleVote on click', async () => {
        const user = userEvent.setup();
        const onToggleVote = vi.fn();
        renderRow({ disabled: true, onToggleVote });

        const voteBtn = screen.getByRole('button', { name: /Vote for/ });
        await user.click(voteBtn);

        expect(onToggleVote).not.toHaveBeenCalled();
    });

    it('Enter on focused vote toggle fires onToggleVote and NOT onOpenDrawer (AC9 keyboard)', async () => {
        const user = userEvent.setup();
        const onToggleVote = vi.fn();
        const onOpenDrawer = vi.fn();
        renderRow({ onToggleVote, onOpenDrawer });

        const voteBtn = screen.getByRole('button', { name: /Vote for/ });
        voteBtn.focus();
        await user.keyboard('{Enter}');

        expect(onToggleVote).toHaveBeenCalledTimes(1);
        // VoteToggleButton.onKeyDown must call e.stopPropagation() so the
        // row's onKeyDown (which calls onOpenDrawer) never sees the event.
        expect(onOpenDrawer).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC4 — Vote bar normalized to votingEligibleCount, NOT totalVoters
// ─────────────────────────────────────────────────────────────────────

describe('VotingRow — normalized vote bar (AC4, canonical regression guard)', () => {
    it('renders the bar at ~8% for 1 vote out of 12 eligible voters (NOT 100%)', () => {
        // This is the explicit fix for the live-walkthrough bug. The bar
        // width is driven from `voteCount / voterDenominator`, never from
        // `voteCount / totalVoters`. We assert on the inline style.width
        // value because it is the load-bearing visual signal — the bug
        // surfaced as a bar that filled the row.
        const { container } = renderRow({
            entry: makeEntry({ voteCount: 1 }),
            voterDenominator: 12,
        });
        // Locate the bar fill (any element whose inline width is set
        // by the helper). Hint: dev should use data-testid="vote-bar-fill".
        const fill = container.querySelector('[data-testid="vote-bar-fill"]');
        expect(fill).not.toBeNull();
        const widthStr = (fill as HTMLElement).style.width;
        // Must be ~8%, NEVER 100%, NEVER NaN%.
        expect(widthStr).toMatch(/^8%$/);
        expect(widthStr).not.toBe('100%');
        expect(widthStr).not.toContain('NaN');
    });

    it('renders the bar at 100% only when every eligible voter has voted', () => {
        const { container } = renderRow({
            entry: makeEntry({ voteCount: 12 }),
            voterDenominator: 12,
        });
        const fill = container.querySelector('[data-testid="vote-bar-fill"]');
        expect((fill as HTMLElement).style.width).toBe('100%');
    });

    it('renders the "X/N" label using the voter denominator', () => {
        // Per spec §"Normalized vote-bar math": label reads "X/N" (e.g.
        // "8/12"), NOT "8 votes" (legacy).
        renderRow({
            entry: makeEntry({ voteCount: 1 }),
            voterDenominator: 12,
        });
        expect(screen.getByText('1/12')).toBeInTheDocument();
    });

    it('renders 0% with no NaN when voterDenominator is 0 (defensive)', () => {
        const { container } = renderRow({
            entry: makeEntry({ voteCount: 0 }),
            voterDenominator: 0,
        });
        const fill = container.querySelector('[data-testid="vote-bar-fill"]');
        // Either explicit "0%" or absent inline width — either is safe.
        const widthStr = (fill as HTMLElement | null)?.style.width ?? '';
        expect(widthStr).not.toContain('NaN');
    });
});

// ─────────────────────────────────────────────────────────────────────
// ROK-1373 — explicit green Vote button + row body no longer navigates
// ─────────────────────────────────────────────────────────────────────

describe('VotingRow — explicit vote button (ROK-1373)', () => {
    it('renders a labeled "Vote" button (not just an unlabeled ring)', () => {
        renderRow({ isVoted: false });
        expect(
            screen.getByRole('button', { name: /Vote for/ }),
        ).toHaveTextContent('Vote');
    });

    it('shows "Voted" once the viewer has voted', () => {
        renderRow({ isVoted: true });
        expect(
            screen.getByRole('button', { name: /Vote for/ }),
        ).toHaveTextContent('Voted');
    });

    it('clicking the row body (game name) does NOT navigate away', async () => {
        const user = userEvent.setup();
        const onOpenDrawer = vi.fn();
        renderRow({ onOpenDrawer, entry: makeEntry({ gameName: 'Valheim' }) });
        await user.click(screen.getByText('Valheim'));
        expect(onOpenDrawer).not.toHaveBeenCalled();
    });
});
