/**
 * ROK-1555 — "B · sheet" wireframe smoke coverage.
 *
 * Same bar as the sibling wireframe tests: dev-only DEMO_MODE panels, so the
 * assertions are behavioural (does the ballot mount for every audited state,
 * does a tap read back the model, does the stale strip follow the viewer's
 * template age) rather than visual. The tap semantics asserted here are the
 * ones argued in `docs/spikes/rok-1540-scheduling-poll-audit.md` §c.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { LayoutBSheetBallot } from '../LayoutBSheetBallot';
import { SchedulingWireframesPage } from '../SchedulingWireframesPage';
import { WF_STATES, pollFor } from '../wireframe-states';

const mockStatus = vi.fn();
vi.mock('../../../hooks/use-system-status', () => ({
  useSystemStatus: () => mockStatus(),
}));

beforeEach(() => {
  mockStatus.mockReturnValue({ data: { demoMode: true }, isLoading: false });
});

/** The desktop treatment, so cell queries never match the mobile twin. */
function desktop(): HTMLElement {
  return screen.getByTestId('wf-bs-desktop');
}

describe('LayoutBSheetBallot — the grid as the ballot', () => {
  it('mounts a desktop and a mobile treatment, each inside a sheet frame', () => {
    renderWithProviders(<LayoutBSheetBallot state="open-unvoted" />);
    expect(desktop()).toBeInTheDocument();
    expect(screen.getByTestId('wf-bs-mobile')).toBeInTheDocument();
    expect(screen.getAllByTestId('wf-bs-grid')).toHaveLength(2);
    expect(within(desktop()).getByText(/Modal · ≥768px/)).toBeInTheDocument();
    expect(within(screen.getByTestId('wf-bs-mobile')).getByText(/Bottom sheet · 375px/)).toBeInTheDocument();
  });

  it.each(WF_STATES.map((s) => s.id))('renders the %s state', (state) => {
    renderWithProviders(<LayoutBSheetBallot state={state} />);
    expect(desktop()).toBeInTheDocument();
  });

  it('opens with the shipped header strip in both treatments (operator ruling)', () => {
    renderWithProviders(<LayoutBSheetBallot state="open-unvoted" />);
    expect(screen.getAllByTestId('wf-shipped-header')).toHaveLength(2);
  });

  it('separates free from unknown on every cell label, never merging them', () => {
    // The whole point of the model change: a stale template is not a free one.
    renderWithProviders(<LayoutBSheetBallot state="open-unvoted" />);
    const cell = within(desktop()).getAllByRole('button', { name: /free, .* unknown/ })[0];
    expect(cell).toBeEnabled();
  });

  it('says an empty cell proposes AND votes in one call when tapped', () => {
    renderWithProviders(<LayoutBSheetBallot state="open-unvoted" />);
    const empty = within(desktop()).getAllByRole('button', { name: /no time proposed yet/ })[0];
    fireEvent.click(empty);
    expect(within(desktop()).getByTestId('wf-bs-readout')).toHaveTextContent(
      /proposes this time AND casts your vote/,
    );
  });

  it('offers withdraw on a cell the viewer already voted in, and vote on one they have not', () => {
    renderWithProviders(<LayoutBSheetBallot state="voted" />);
    const mine = within(desktop()).getAllByRole('button', { pressed: true })[0];
    fireEvent.click(mine);
    expect(within(desktop()).getByTestId('wf-bs-readout')).toHaveTextContent(/withdraws your vote/);

    const theirs = within(desktop()).getAllByRole('button', { pressed: false })[0];
    fireEvent.click(theirs);
    expect(within(desktop()).getByTestId('wf-bs-readout')).toHaveTextContent(/Tapping votes for this time/);
  });

  it('goes inert in every terminal state instead of offering a vote that will fail', () => {
    for (const state of ['locked', 'cancelled', 'expired', 'read-only-viewer'] as const) {
      const { unmount } = renderWithProviders(<LayoutBSheetBallot state={state} />);
      const cells = within(desktop()).getAllByRole('button', { name: /free, .* unknown/ });
      expect(cells.every((c) => (c as HTMLButtonElement).disabled)).toBe(true);
      unmount();
    }
  });

  it('shows the inline refresh strip for a stale viewer and hides it for a fresh one', () => {
    // 41 days on the baseline poll, 3 days in the `voted` state — prod has 6 of
    // 9 templated members stale, so the strip is the ordinary case.
    expect(pollFor('open-unvoted').viewerGameTimeAgeDays).toBe(41);
    renderWithProviders(<LayoutBSheetBallot state="open-unvoted" />);
    expect(screen.getAllByTestId('wf-bs-stale')[0]).toHaveTextContent('41 days old');

    screen.getAllByTestId('wf-bs-stale').forEach((el) => expect(el).toBeInTheDocument());
  });

  it('hides the strip when the viewer confirmed inside the freshness window', () => {
    expect(pollFor('voted').viewerGameTimeAgeDays).toBe(3);
    renderWithProviders(<LayoutBSheetBallot state="voted" />);
    expect(screen.queryByTestId('wf-bs-stale')).not.toBeInTheDocument();
  });

  it('names the viewer as an unknown when they never set a game time', () => {
    renderWithProviders(<LayoutBSheetBallot state="no-availability" />);
    expect(screen.getAllByTestId('wf-bs-stale')[0]).toHaveTextContent(/one of the unknowns/);
  });
});

describe('SchedulingWireframesPage — the B · sheet switcher entry', () => {
  it('swaps to the sheet ballot and back without leaving the ladder mounted', () => {
    renderWithProviders(<SchedulingWireframesPage />);
    fireEvent.click(screen.getByTestId('wf-layout-bs'));
    expect(screen.getByTestId('wf-bs-desktop')).toBeInTheDocument();
    expect(screen.queryByTestId('wf-b-desktop')).not.toBeInTheDocument();
    expect(screen.getByTestId('wf-rationale')).toHaveTextContent('replaces the body only');
  });
});
