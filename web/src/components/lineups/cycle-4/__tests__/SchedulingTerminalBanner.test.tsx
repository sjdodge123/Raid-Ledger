/**
 * ROK-1545 (P1-3) — terminal poll states say what happened.
 *
 * Today ONE amber "This poll is read-only. Voting is closed." covers lock-in,
 * cancellation and expiry alike (audit F-01/F-02/F-04). These tests pin the
 * three distinct endings:
 *   AC1 locked-in names the winning time and links the created event.
 *   AC2 cancelled is textually distinct and renders the operator's reason.
 *   AC3 expired says the deadline passed without a lock-in + the next action.
 * The container keeps `data-testid="read-only-banner"` — the shipped smoke
 * specs resolve that id — and is a `role="status"` live region.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingTerminalBanner } from '../SchedulingTerminalBanner';

const LOCKED_TIME = '2026-06-10T20:00:00.000Z';

describe('SchedulingTerminalBanner (ROK-1545)', () => {
  it('renders nothing while the poll is open', () => {
    renderWithProviders(
      <SchedulingTerminalBanner
        pollStatus="open"
        lockedInTime={null}
        cancelReason={null}
        linkedEventId={null}
      />,
    );
    expect(screen.queryByTestId('read-only-banner')).toBeNull();
  });

  it('AC1 — locked in names the winning time and links the created event', () => {
    renderWithProviders(
      <SchedulingTerminalBanner
        pollStatus="locked_in"
        lockedInTime={LOCKED_TIME}
        cancelReason={null}
        linkedEventId={314}
      />,
    );
    const banner = screen.getByTestId('read-only-banner');
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveTextContent(/locked in/i);
    // The winning time, not a generic "voting is closed".
    expect(banner).toHaveTextContent(
      new Date(LOCKED_TIME).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    );
    expect(banner).not.toHaveTextContent(/voting is closed/i);
    expect(screen.getByTestId('terminal-event-link')).toHaveAttribute(
      'href',
      '/events/314',
    );
  });

  it('AC1 — locked in with no linked event still names the time, without a link', () => {
    renderWithProviders(
      <SchedulingTerminalBanner
        pollStatus="locked_in"
        lockedInTime={LOCKED_TIME}
        cancelReason={null}
        linkedEventId={null}
      />,
    );
    expect(screen.getByTestId('read-only-banner')).toHaveTextContent(
      /locked in/i,
    );
    expect(screen.queryByTestId('terminal-event-link')).toBeNull();
  });

  it('AC2 — cancelled renders the operator reason and is distinct from locked in', () => {
    renderWithProviders(
      <SchedulingTerminalBanner
        pollStatus="cancelled"
        lockedInTime={null}
        cancelReason="Half the roster is out for the holiday."
        linkedEventId={null}
      />,
    );
    const banner = screen.getByTestId('read-only-banner');
    expect(banner).toHaveTextContent(/poll cancelled/i);
    expect(banner).toHaveTextContent('Half the roster is out for the holiday.');
    expect(banner).not.toHaveTextContent(/locked in/i);
    expect(banner).toHaveAttribute('data-poll-status', 'cancelled');
  });

  it('AC2 — cancelled without a reason says so rather than rendering an empty quote', () => {
    renderWithProviders(
      <SchedulingTerminalBanner
        pollStatus="cancelled"
        lockedInTime={null}
        cancelReason={null}
        linkedEventId={null}
      />,
    );
    const banner = screen.getByTestId('read-only-banner');
    expect(banner).toHaveTextContent(/poll cancelled/i);
    expect(banner).toHaveTextContent(/no reason was given/i);
  });

  /**
   * ROK-1546 AC4 — every terminal/read-only ending is an announced live
   * region, not a silently-swapped div. A screen-reader user who has the
   * ladder focused when the poll locks in, is cancelled or expires must hear
   * what happened; `role="status"` (implicit `aria-live="polite"`) is what
   * carries that, so it is asserted per variant rather than once.
   */
  it.each([
    ['locked_in' as const, /locked in/i],
    ['cancelled' as const, /poll cancelled/i],
    ['closed' as const, /poll expired/i],
  ])('AC4 — the %s banner is a role=status live region', (status, copy) => {
    renderWithProviders(
      <SchedulingTerminalBanner
        pollStatus={status}
        lockedInTime={LOCKED_TIME}
        cancelReason="Half the roster is out."
        linkedEventId={null}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(copy);
  });

  it('AC3 — expired says the deadline passed without a lock-in and what happens next', () => {
    renderWithProviders(
      <SchedulingTerminalBanner
        pollStatus="closed"
        lockedInTime={null}
        cancelReason={null}
        linkedEventId={null}
      />,
    );
    const banner = screen.getByTestId('read-only-banner');
    expect(banner).toHaveTextContent(/the deadline passed without a lock-in/i);
    expect(banner).toHaveTextContent(/start a new poll/i);
    expect(banner).toHaveAttribute('data-poll-status', 'closed');
  });
});
