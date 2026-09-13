/**
 * ROK-1540 wireframe smoke coverage.
 *
 * These are dev-only DEMO_MODE routes, so the bar is deliberately low and
 * behavioural rather than visual: each candidate layout mounts for every
 * audited state without throwing, the DEMO_MODE gate redirects, and the two
 * switchers actually change what is rendered. Anything finer would be
 * asserting a wireframe's pixels, which is what the operator walk is for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { LayoutAHeatmap } from '../LayoutAHeatmap';
import { LayoutBLadder } from '../LayoutBLadder';
import { LayoutCTimeline } from '../LayoutCTimeline';
import { SchedulingWireframesPage } from '../SchedulingWireframesPage';
import { WF_STATES, pollFor, leader, isTied } from '../wireframe-states';

const mockStatus = vi.fn();
vi.mock('../../../hooks/use-system-status', () => ({
  useSystemStatus: () => mockStatus(),
}));

beforeEach(() => {
  mockStatus.mockReturnValue({ data: { demoMode: true }, isLoading: false });
});

const LAYOUTS = [
  { name: 'A · calendar-first heatmap', Cmp: LayoutAHeatmap, testId: 'wf-a-desktop' },
  { name: 'B · slot cards / vote ladder', Cmp: LayoutBLadder, testId: 'wf-b-desktop' },
  { name: 'C · conversation timeline', Cmp: LayoutCTimeline, testId: 'wf-c-desktop' },
];

describe.each(LAYOUTS)('$name', ({ Cmp, testId }) => {
  it('mounts a desktop and a mobile treatment', () => {
    renderWithProviders(<Cmp state="open-unvoted" />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
    expect(screen.getByTestId('wf-desktop')).toBeInTheDocument();
    expect(screen.getByTestId('wf-mobile')).toBeInTheDocument();
  });

  it.each(WF_STATES.map((s) => s.id))('renders the %s state', (state) => {
    renderWithProviders(<Cmp state={state} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
});

describe('SchedulingWireframesPage — DEMO_MODE gate', () => {
  it('renders nothing while system status is loading', () => {
    mockStatus.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderWithProviders(<SchedulingWireframesPage />);
    expect(container).toBeEmptyDOMElement();
  });

  it('redirects away when DEMO_MODE is off', () => {
    mockStatus.mockReturnValue({ data: { demoMode: false }, isLoading: false });
    renderWithProviders(<SchedulingWireframesPage />);
    expect(screen.queryByTestId('wf-layout-picker')).not.toBeInTheDocument();
  });
});

describe('SchedulingWireframesPage — switchers', () => {
  it('defaults to candidate B and swaps layout on click', () => {
    renderWithProviders(<SchedulingWireframesPage />);
    expect(screen.getByTestId('wf-b-desktop')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('wf-layout-a'));
    expect(screen.getByTestId('wf-a-desktop')).toBeInTheDocument();
    expect(screen.queryByTestId('wf-b-desktop')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('wf-layout-c'));
    expect(screen.getByTestId('wf-c-desktop')).toBeInTheDocument();
  });

  it('changes the rendered state and its note when a state chip is clicked', () => {
    renderWithProviders(<SchedulingWireframesPage />);
    expect(screen.getByTestId('wf-state-note')).toHaveTextContent(pollFor('open-unvoted').note);

    fireEvent.click(screen.getByTestId('wf-state-locked'));
    expect(screen.getByTestId('wf-state-note')).toHaveTextContent(pollFor('locked').note);
    expect(screen.getByTestId('wf-state-locked')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('wf-status')[0]).toHaveTextContent('LOCKED IN');
  });

  it('exposes every audited state as a switchable chip', () => {
    renderWithProviders(<SchedulingWireframesPage />);
    for (const s of WF_STATES) {
      expect(screen.getByTestId(`wf-state-${s.id}`)).toBeInTheDocument();
    }
  });
});

describe('wireframe-states — the shared tiebreak rule (F-03)', () => {
  it('breaks a tie by the earlier slot, matching what the copy claims', () => {
    const tied = pollFor('tie');
    expect(isTied(tied)).toBe(true);
    expect(leader(tied)?.id).toBe(1);
  });

  it('leaves an empty poll without a leader', () => {
    expect(leader(pollFor('open-empty'))).toBeNull();
  });
});
