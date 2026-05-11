/**
 * Unit tests for GraceCountdownBanner (ROK-1253).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { GraceCountdownBanner } from '../grace-countdown-banner';

describe('GraceCountdownBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when pendingAdvanceAt is null', () => {
    const { container } = render(
      <GraceCountdownBanner pendingAdvanceAt={null} status="voting" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when pendingAdvanceAt is already in the past', () => {
    const past = new Date('2026-05-10T11:59:00Z').toISOString();
    const { container } = render(
      <GraceCountdownBanner pendingAdvanceAt={past} status="voting" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the banner with formatted countdown when pendingAdvanceAt is in the future', () => {
    const future = new Date('2026-05-10T12:01:30Z').toISOString(); // 90s
    render(
      <GraceCountdownBanner pendingAdvanceAt={future} status="voting" />,
    );
    expect(screen.getByTestId('grace-countdown-banner')).toBeInTheDocument();
    expect(screen.getByTestId('grace-countdown-time').textContent).toBe(
      '1m 30s',
    );
  });

  it('uses "nominating" copy when status is building', () => {
    const future = new Date('2026-05-10T12:01:00Z').toISOString();
    render(
      <GraceCountdownBanner pendingAdvanceAt={future} status="building" />,
    );
    expect(screen.getByTestId('grace-countdown-banner').textContent).toContain(
      'nominating',
    );
  });

  it('uses "voting" copy when status is voting', () => {
    const future = new Date('2026-05-10T12:00:30Z').toISOString();
    render(
      <GraceCountdownBanner pendingAdvanceAt={future} status="voting" />,
    );
    expect(screen.getByTestId('grace-countdown-banner').textContent).toContain(
      'voting',
    );
  });

  it('updates the countdown text on each interval tick', () => {
    const future = new Date('2026-05-10T12:00:05Z').toISOString(); // 5s
    render(
      <GraceCountdownBanner pendingAdvanceAt={future} status="voting" />,
    );
    expect(screen.getByTestId('grace-countdown-time').textContent).toBe('5s');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByTestId('grace-countdown-time').textContent).toBe('3s');
  });
});
