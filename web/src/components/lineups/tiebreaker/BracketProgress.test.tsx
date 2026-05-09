/**
 * Tests for BracketProgress (ROK-1218).
 * F-29 from ROK-1193 audit — progress meter for multi-matchup bracket rounds.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BracketMatchupDto } from '@raid-ledger/contract';
import { BracketProgress } from './BracketProgress';

function matchup(overrides: Partial<BracketMatchupDto> = {}): BracketMatchupDto {
    return {
        id: 1,
        round: 1,
        position: 0,
        gameA: { gameId: 1, gameName: 'A', gameCoverUrl: null, originalVoteCount: 0 },
        gameB: { gameId: 2, gameName: 'B', gameCoverUrl: null, originalVoteCount: 0 },
        isBye: false,
        winnerGameId: null,
        voteCountA: 0,
        voteCountB: 0,
        myVote: null,
        isActive: true,
        isCompleted: false,
        ...overrides,
    };
}

describe('BracketProgress — counting votes', () => {
    it('shows 0 of N when the user has not voted in any active matchup', () => {
        const matchups = [matchup({ id: 1 }), matchup({ id: 2 }), matchup({ id: 3 })];
        render(<BracketProgress matchups={matchups} />);
        const progress = screen.getByTestId('bracket-progress');
        expect(progress).toHaveAttribute('data-done', '0');
        expect(progress).toHaveAttribute('data-total', '3');
        expect(progress).toHaveTextContent(/voted in 0 of 3 matchups/i);
    });

    it('reflects votes already cast in the current round', () => {
        const matchups = [
            matchup({ id: 1, myVote: 1 }),
            matchup({ id: 2, myVote: 2 }),
            matchup({ id: 3 }),
        ];
        render(<BracketProgress matchups={matchups} />);
        const progress = screen.getByTestId('bracket-progress');
        expect(progress).toHaveAttribute('data-done', '2');
        expect(progress).toHaveAttribute('data-total', '3');
        expect(progress).toHaveTextContent(/voted in 2 of 3 matchups/i);
    });

    it('shows complete state when every active matchup has a vote', () => {
        const matchups = [matchup({ id: 1, myVote: 1 }), matchup({ id: 2, myVote: 2 })];
        render(<BracketProgress matchups={matchups} />);
        const progress = screen.getByTestId('bracket-progress');
        expect(progress).toHaveAttribute('data-done', '2');
        expect(progress).toHaveAttribute('data-total', '2');
    });
});

describe('BracketProgress — what counts as "votable"', () => {
    it('excludes bye matchups from the total', () => {
        const matchups = [
            matchup({ id: 1 }),
            matchup({ id: 2 }),
            matchup({ id: 3, isBye: true, gameB: null }),
        ];
        render(<BracketProgress matchups={matchups} />);
        expect(screen.getByTestId('bracket-progress')).toHaveAttribute('data-total', '2');
    });

    it('excludes inactive matchups (already-resolved or future rounds)', () => {
        const matchups = [
            matchup({ id: 1, isActive: true }),
            matchup({ id: 2, isActive: false, isCompleted: true, winnerGameId: 1 }),
            matchup({ id: 3, isActive: false }),
        ];
        render(<BracketProgress matchups={matchups} />);
        const progress = screen.getByTestId('bracket-progress');
        expect(progress).toHaveAttribute('data-done', '0');
        expect(progress).toHaveAttribute('data-total', '1');
    });

    it('renders nothing when there are no active matchups to vote on', () => {
        const matchups = [
            matchup({ id: 1, isActive: false, isCompleted: true }),
            matchup({ id: 2, isBye: true, gameB: null, isActive: false }),
        ];
        const { container } = render(<BracketProgress matchups={matchups} />);
        expect(container.firstChild).toBeNull();
    });
});
