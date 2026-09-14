/**
 * ROK-1555 — "B · sheet" wireframe smoke coverage.
 *
 * Same bar as the sibling wireframe tests: dev-only DEMO_MODE panels, so the
 * assertions are behavioural (does the ballot mount for every audited state,
 * does a tap read back the model, does the two-step flow route a stale viewer
 * through the game-time check) rather than visual. The tap semantics asserted
 * here are the ones argued in `docs/spikes/rok-1540-scheduling-poll-audit.md`
 * §c; the two steps are the operator ruling recorded in §d.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { LayoutBSheetBallot } from '../LayoutBSheetBallot';
import { SchedulingWireframesPage } from '../SchedulingWireframesPage';
import { WF_STATES, pollFor, type WfStateId } from '../wireframe-states';

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

/**
 * Render and land on step 2. A stale viewer now opens on the game-time check,
 * so every ballot assertion has to skip past it first (in both treatments).
 */
function renderBallot(state: WfStateId): void {
  renderWithProviders(<LayoutBSheetBallot state={state} />);
  screen.queryAllByTestId('wf-bs-skip').forEach((b) => fireEvent.click(b));
}

describe('LayoutBSheetBallot — the grid as the ballot', () => {
  it('mounts a desktop and a mobile treatment, each inside a sheet frame', () => {
    renderBallot('open-unvoted');
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
    // The whole point of the model change: a stale template is not a free one,
    // so the two channels must be two DIFFERENT numbers on the same label.
    renderBallot('open-unvoted');
    const cells = within(desktop()).getAllByRole('button', { name: /free, .* unknown/ });
    const pairs = cells.map((c) => {
      const m = (c.getAttribute('aria-label') ?? '').match(/(\d+) free, (\d+) unknown/);
      expect(m).not.toBeNull();
      return [Number(m?.[1]), Number(m?.[2])] as const;
    });
    expect(cells[0]).toBeEnabled();
    // Both channels are live, and they disagree — a merged count could not do this.
    expect(pairs.some(([free, unknown]) => free > 0 && unknown > 0 && free !== unknown)).toBe(true);
    expect(pairs.every(([free, unknown]) => free + unknown <= pollFor('open-unvoted').members)).toBe(true);
  });

  it('says an empty cell proposes AND votes in one call when tapped', () => {
    renderBallot('open-unvoted');
    const empty = within(desktop()).getAllByRole('button', { name: /no time proposed yet/ })[0];
    fireEvent.click(empty);
    expect(within(desktop()).getByTestId('wf-bs-readout')).toHaveTextContent(
      /proposes this time AND casts your vote/,
    );
  });

  it('offers withdraw on a cell the viewer already voted in, and vote on one they have not', () => {
    renderBallot('voted');
    const mine = within(desktop()).getAllByRole('button', { pressed: true })[0];
    fireEvent.click(mine);
    expect(within(desktop()).getByTestId('wf-bs-readout')).toHaveTextContent(/withdraws your vote/);

    const theirs = within(desktop()).getAllByRole('button', { pressed: false })[0];
    fireEvent.click(theirs);
    expect(within(desktop()).getByTestId('wf-bs-readout')).toHaveTextContent(/Tapping votes for this time/);
  });

  it('goes inert in every terminal state instead of offering a vote that will fail', () => {
    for (const state of ['locked', 'cancelled', 'expired', 'read-only-viewer'] as const) {
      renderBallot(state);
      const cells = within(desktop()).getAllByRole('button', { name: /free, .* unknown/ });
      expect(cells.every((c) => (c as HTMLButtonElement).disabled)).toBe(true);
      cleanup();
    }
  });

});

describe('LayoutBSheetBallot — the two-step sheet (operator ruling 2026-09-14)', () => {
  it('opens a stale viewer on step 1 with the three answers and a skip', () => {
    // 41 days on the baseline poll — prod has 6 of 9 templated members stale,
    // so step 1 is the ordinary first screen, not an edge case.
    expect(pollFor('open-unvoted').viewerGameTimeAgeDays).toBe(41);
    renderWithProviders(<LayoutBSheetBallot state="open-unvoted" />);
    const step1 = within(desktop()).getByTestId('wf-bs-step1');
    expect(step1).toHaveTextContent('Your game time is 41 days old. Anything changed?');
    expect(within(step1).getByTestId('wf-bs-confirm')).toBeInTheDocument();
    expect(within(step1).getByTestId('wf-bs-absence')).toBeInTheDocument();
    expect(within(step1).getByTestId('wf-bs-edit')).toHaveAttribute('href', '/profile#game-time');
    expect(within(step1).getByTestId('wf-bs-skip')).toBeInTheDocument();
    expect(within(desktop()).queryByTestId('wf-bs-grid')).not.toBeInTheDocument();
  });

  it('reveals the absence date stub inline — never the week painter', () => {
    renderWithProviders(<LayoutBSheetBallot state="open-unvoted" />);
    expect(within(desktop()).queryByTestId('wf-bs-absence-row')).not.toBeInTheDocument();
    fireEvent.click(within(desktop()).getByTestId('wf-bs-absence'));
    expect(within(desktop()).getByTestId('wf-bs-absence-row')).toBeInTheDocument();
  });

  it('"Looks right" advances to the ballot AND un-hatches the viewer row', () => {
    renderWithProviders(<LayoutBSheetBallot state="open-unvoted" />);
    fireEvent.click(within(desktop()).getByTestId('wf-bs-confirm'));
    expect(within(desktop()).queryByTestId('wf-bs-step1')).not.toBeInTheDocument();
    expect(within(desktop()).getByTestId('wf-bs-grid')).toBeInTheDocument();
    expect(within(desktop()).getByTestId('wf-bs-viewer-row')).toHaveAttribute('data-hatched', 'false');
  });

  it('"Skip" advances to the ballot and leaves the viewer hatched as unknown', () => {
    renderWithProviders(<LayoutBSheetBallot state="open-unvoted" />);
    fireEvent.click(within(desktop()).getByTestId('wf-bs-skip'));
    expect(within(desktop()).getByTestId('wf-bs-grid')).toBeInTheDocument();
    const row = within(desktop()).getByTestId('wf-bs-viewer-row');
    expect(row).toHaveAttribute('data-hatched', 'true');
    expect(row).toHaveTextContent(/still counted as unknown/);
  });

  it('opens a viewer inside the freshness window straight on the ballot', () => {
    expect(pollFor('voted').viewerGameTimeAgeDays).toBe(3);
    renderWithProviders(<LayoutBSheetBallot state="voted" />);
    expect(within(desktop()).queryByTestId('wf-bs-step1')).not.toBeInTheDocument();
    expect(within(desktop()).getByTestId('wf-bs-grid')).toBeInTheDocument();
    expect(within(desktop()).getByTestId('wf-bs-viewer-row')).toHaveAttribute('data-hatched', 'false');
  });

  it('names the viewer as an unknown when they never set a game time', () => {
    renderWithProviders(<LayoutBSheetBallot state="no-availability" />);
    expect(within(desktop()).getByTestId('wf-bs-step1')).toHaveTextContent(/never|haven't set/i);
  });

  it('keeps segment 1 tappable from step 2, so the check can be revisited', () => {
    renderWithProviders(<LayoutBSheetBallot state="voted" />);
    const stepper = within(desktop()).getByTestId('wf-bs-stepper');
    const [gameTime, vote] = within(stepper).getAllByRole('button');
    expect(vote).toHaveAttribute('aria-current', 'step');
    fireEvent.click(gameTime);
    expect(within(desktop()).getByTestId('wf-bs-step1')).toBeInTheDocument();
    expect(within(within(desktop()).getByTestId('wf-bs-stepper')).getAllByRole('button')[0])
      .toHaveAttribute('aria-current', 'step');
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
