/**
 * Tests for PollDeadlineBanner (ROK-1217 / F-36).
 * Verifies absolute + relative rendering and the <24h urgent variant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PollDeadlineBanner } from './PollDeadlineBanner';

const FIXED_NOW = new Date('2026-05-09T12:00:00.000Z').getTime();

describe('PollDeadlineBanner (ROK-1217)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when phaseDeadline is null', () => {
    const { container } = render(<PollDeadlineBanner phaseDeadline={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when phaseDeadline is undefined', () => {
    const { container } = render(<PollDeadlineBanner phaseDeadline={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders absolute + relative deadline copy when more than 24h away', () => {
    // 3 days from FIXED_NOW
    const deadline = new Date(FIXED_NOW + 3 * 24 * 60 * 60 * 1000).toISOString();
    render(<PollDeadlineBanner phaseDeadline={deadline} />);
    const banner = screen.getByTestId('poll-deadline-banner');
    expect(banner).toHaveAttribute('data-soon', 'false');
    expect(banner).toHaveAttribute('data-expired', 'false');
    expect(banner.textContent).toMatch(/Closes/);
    expect(banner.textContent).toMatch(/in \d+ days?/);
  });

  it('includes the calendar date when the deadline is a week or more away', () => {
    // 10 days from FIXED_NOW (2026-05-19) — a bare weekday would be ambiguous
    const deadline = new Date(FIXED_NOW + 10 * 24 * 60 * 60 * 1000).toISOString();
    render(<PollDeadlineBanner phaseDeadline={deadline} />);
    const banner = screen.getByTestId('poll-deadline-banner');
    expect(banner.textContent).toMatch(/Closes \w{3}, May 19 at/);
  });

  it('uses the bare weekday when the deadline is within the week', () => {
    const deadline = new Date(FIXED_NOW + 3 * 24 * 60 * 60 * 1000).toISOString();
    render(<PollDeadlineBanner phaseDeadline={deadline} />);
    const banner = screen.getByTestId('poll-deadline-banner');
    expect(banner.textContent).not.toMatch(/May \d/);
  });

  it('uses urgent (soon) variant when less than 24h remain', () => {
    // 5 hours from FIXED_NOW
    const deadline = new Date(FIXED_NOW + 5 * 60 * 60 * 1000).toISOString();
    render(<PollDeadlineBanner phaseDeadline={deadline} />);
    const banner = screen.getByTestId('poll-deadline-banner');
    expect(banner).toHaveAttribute('data-soon', 'true');
    expect(banner).toHaveAttribute('data-expired', 'false');
    expect(banner.textContent).toMatch(/in about 5 hours|in 5 hours/);
  });

  it('marks the banner as expired and shows "closed" when the deadline has passed', () => {
    const deadline = new Date(FIXED_NOW - 60 * 60 * 1000).toISOString();
    render(<PollDeadlineBanner phaseDeadline={deadline} />);
    const banner = screen.getByTestId('poll-deadline-banner');
    expect(banner).toHaveAttribute('data-expired', 'true');
    expect(banner).toHaveAttribute('data-soon', 'false');
    expect(banner.textContent).toMatch(/closed/);
  });

  it('renders nothing when phaseDeadline is malformed', () => {
    const { container } = render(<PollDeadlineBanner phaseDeadline="not-a-date" />);
    expect(container).toBeEmptyDOMElement();
  });
});
