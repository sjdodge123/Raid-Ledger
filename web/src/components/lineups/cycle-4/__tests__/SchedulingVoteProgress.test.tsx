/**
 * The hero's vote-progress bar measures poll PARTICIPATION (distinct voters on
 * any time vs the poll's `minVoteThreshold`). The lock-in confirm measures
 * something else — how many picked ONE time vs a majority of members — and
 * says "below majority". #2132's verify lane saw "Majority reached" here and
 * "below majority?" in the confirm at once, so this copy must never claim a
 * majority.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { SchedulingVoteProgress } from '../SchedulingVoteProgress';

function matchWithThreshold(minVoteThreshold: number | null): MatchDetailResponseDto {
    return { minVoteThreshold } as unknown as MatchDetailResponseDto;
}

describe('SchedulingVoteProgress', () => {
    it('renders nothing without a configured threshold', () => {
        const { container } = render(
            <SchedulingVoteProgress match={matchWithThreshold(null)} uniqueVoterCount={2} />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('says the vote target is reached — never "majority" — once enough people voted', () => {
        render(<SchedulingVoteProgress match={matchWithThreshold(3)} uniqueVoterCount={3} />);
        expect(screen.getByTestId('vote-progress-text')).toHaveTextContent('3/3 voted');
        expect(screen.queryByText(/majority/i)).not.toBeInTheDocument();
        expect(screen.getByText('Vote target reached')).toBeInTheDocument();
    });

    it('counts the voters still needed below the target, without "majority"', () => {
        render(<SchedulingVoteProgress match={matchWithThreshold(5)} uniqueVoterCount={2} />);
        expect(screen.queryByText(/majority/i)).not.toBeInTheDocument();
        expect(screen.getByText('3 more to reach the vote target')).toBeInTheDocument();
    });
});
