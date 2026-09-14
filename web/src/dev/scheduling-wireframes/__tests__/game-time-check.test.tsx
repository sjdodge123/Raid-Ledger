/**
 * ROK-1555 — "B · game-time check (two steps)" wireframe coverage.
 *
 * The heatmap-as-ballot panel was REJECTED (ruling 2026-09-14 17:38Z, recorded
 * in `docs/spikes/rok-1540-scheduling-poll-audit.md`): the vote ladder is the
 * only ballot. What survives is §d's two-step check, so this is the only
 * behaviour left to assert — the step asks one question, offers three answers
 * plus a skip, and both terminal answers advance to the ladder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { GameTimeCheckPanel } from '../GameTimeCheckPanel';

const mockStatus = vi.fn();
vi.mock('../../../hooks/use-system-status', () => ({
  useSystemStatus: () => mockStatus(),
}));

beforeEach(() => {
  mockStatus.mockReturnValue({ data: { demoMode: true }, isLoading: false });
});

describe('GameTimeCheckPanel', () => {
  it('renders the desktop and the 375px frame', () => {
    renderWithProviders(<GameTimeCheckPanel state="open-unvoted" />);
    expect(screen.getByTestId('wf-gtc-desktop')).toBeInTheDocument();
    expect(screen.getByTestId('wf-gtc-mobile')).toBeInTheDocument();
  });

  it('offers the three answers plus Skip', () => {
    renderWithProviders(<GameTimeCheckPanel state="open-unvoted" />);
    const frame = within(screen.getByTestId('wf-gtc-desktop'));
    expect(frame.getByTestId('wf-bs-confirm')).toBeInTheDocument();
    expect(frame.getByTestId('wf-bs-absence')).toBeInTheDocument();
    expect(frame.getByTestId('wf-bs-edit')).toBeInTheDocument();
    expect(frame.getByTestId('wf-bs-skip')).toBeInTheDocument();
  });

  it('advances on both "Looks right" and "Skip"', () => {
    const onAdvance = vi.fn();
    renderWithProviders(<GameTimeCheckPanel state="open-unvoted" onAdvance={onAdvance} />);
    const frame = within(screen.getByTestId('wf-gtc-desktop'));
    fireEvent.click(frame.getByTestId('wf-bs-confirm'));
    expect(onAdvance).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByTestId('wf-gtc-mobile')).getByTestId('wf-bs-skip'));
    expect(onAdvance).toHaveBeenCalledTimes(2);
  });

  it('marks step 1 as the current step in the stepper', () => {
    renderWithProviders(<GameTimeCheckPanel state="open-unvoted" />);
    const stepper = within(screen.getByTestId('wf-gtc-desktop')).getByTestId('wf-bs-stepper');
    expect(within(stepper).getByText('1 Game time')).toHaveAttribute('aria-current', 'step');
    expect(within(stepper).getByText('2 Vote')).not.toHaveAttribute('aria-current');
  });
});
