/**
 * Tests for ConfirmationPill (ROK-1209).
 *
 * Three variants: 'text', 'count', 'waitingOnN'. Used across all 6 lineup
 * action surfaces. AC-1, AC-2, AC-3, AC-4, AC-13.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfirmationPill } from './ConfirmationPill';

describe('ConfirmationPill — three variants', () => {
  it("renders 'text' variant with children and the ✓ glyph", () => {
    render(<ConfirmationPill variant="text">Your nomination</ConfirmationPill>);
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('Your nomination');
    // The check glyph is part of the pill.
    expect(pill).toHaveTextContent(/✓|check/i);
  });

  it("renders 'count' variant rendering the count payload", () => {
    render(
      <ConfirmationPill variant="count" count="2/3 votes used">
        Voted
      </ConfirmationPill>,
    );
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveTextContent('2/3 votes used');
  });

  it("renders 'waitingOnN' variant including the waiting count", () => {
    render(
      <ConfirmationPill variant="waitingOnN" count={4}>
        You&apos;ve voted
      </ConfirmationPill>,
    );
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveTextContent(/waiting on 4/i);
  });
});

describe('ConfirmationPill — accessibility (AC-13)', () => {
  it('has a default aria-label describing what completed', () => {
    render(<ConfirmationPill variant="text">Your vote</ConfirmationPill>);
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveAttribute('aria-label');
    expect(pill.getAttribute('aria-label')).toMatch(/your vote/i);
  });

  it('respects an explicit aria-label override', () => {
    render(
      <ConfirmationPill variant="text" aria-label="You eliminated Hollowforge">
        You eliminated a game
      </ConfirmationPill>,
    );
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveAttribute('aria-label', 'You eliminated Hollowforge');
  });
});

describe('ConfirmationPill — testids and tone', () => {
  it("emits data-testid='confirmation-pill' on the root element", () => {
    render(<ConfirmationPill variant="text">x</ConfirmationPill>);
    expect(screen.getByTestId('confirmation-pill')).toBeInTheDocument();
  });

  it("supports a 'tone' prop reflected as data-tone for visual variants", () => {
    render(
      <ConfirmationPill variant="text" tone="danger">
        You eliminated a game
      </ConfirmationPill>,
    );
    const pill = screen.getByTestId('confirmation-pill');
    expect(pill).toHaveAttribute('data-tone', 'danger');
  });
});
