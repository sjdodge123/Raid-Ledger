/**
 * Tests for VoteStatusBar component (ROK-936).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoteStatusBar } from './VoteStatusBar';

describe('VoteStatusBar', () => {
  it('shows vote count and max votes', () => {
    render(<VoteStatusBar myVoteCount={2} maxVotes={3} totalVoters={8} totalMembers={12} />);
    expect(screen.getByText(/2 of 3 votes/)).toBeInTheDocument();
  });

  it('shows voter participation count', () => {
    render(<VoteStatusBar myVoteCount={1} maxVotes={3} totalVoters={5} totalMembers={10} />);
    expect(screen.getByText(/5\s*\/\s*10 voted/)).toBeInTheDocument();
  });

  it('shows zero votes used', () => {
    render(<VoteStatusBar myVoteCount={0} maxVotes={3} totalVoters={0} totalMembers={8} />);
    expect(screen.getByText(/0 of 3 votes/)).toBeInTheDocument();
  });

  it('shows all votes used', () => {
    render(<VoteStatusBar myVoteCount={3} maxVotes={3} totalVoters={12} totalMembers={12} />);
    expect(screen.getByText(/3 of 3 votes/)).toBeInTheDocument();
  });
});
