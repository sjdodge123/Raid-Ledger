/**
 * ROK-1570 — the heatmap must ask the server for the week it is PAINTING.
 *
 * The availability aggregate now subtracts each member's signups/absences for
 * a dated week, and the server defaults to the CURRENT week. Week navigation
 * that does not re-query with the displayed week therefore leaves the grid
 * showing this week's commitments on next week's cells.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { stubGridLayout } from '../../../../test/stub-grid-layout';
import { SchedulingAvailability } from '../SchedulingAvailability';
import { getWeekStart } from '../scheduling-availability';

const getMatchAvailabilityMock = vi.fn();

vi.mock('../../../../lib/api-client', () => ({
  getSchedulePoll: vi.fn(),
  toggleScheduleVote: vi.fn(),
  suggestSlot: vi.fn(),
  createEventFromSlot: vi.fn(),
  retractAllVotes: vi.fn(),
  getMatchAvailability: (...args: unknown[]) => getMatchAvailabilityMock(...args),
  getSchedulingBanner: vi.fn(),
  getOtherPolls: vi.fn(),
  cancelSchedulePoll: vi.fn(),
  remindVoters: vi.fn(),
  addPollMembers: vi.fn(),
}));

/** One templated cell so the section renders instead of returning null. */
function buildAggregate(): AggregateGameTimeResponse {
  return {
    eventId: 1,
    totalUsers: 2,
    totalMembers: 2,
    freshnessDays: 7,
    untemplatedMembers: 0,
    viewerGameTimeAgeDays: 0,
    cells: [
      { dayOfWeek: 1, hour: 20, availableCount: 2, totalCount: 2, staleCount: 0, unknownCount: 0 },
    ],
  } as AggregateGameTimeResponse;
}

/** The week the grid opens on, and the one "Next Week →" moves it to. */
function expectedWeeks(): { current: Date; next: Date } {
  const current = getWeekStart(new Date());
  const next = new Date(current);
  next.setDate(next.getDate() + 7);
  return { current, next };
}

/**
 * ROK-1580 put a phone module behind the same component, so this file — which
 * drives the desktop "Next Week →" control — pins the viewport it was always
 * implicitly testing. The phone pager's own week step is covered in
 * `SchedulingAvailability.test.tsx`.
 */
function stubDesktopViewport(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('1024'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('SchedulingAvailability week navigation (ROK-1570)', () => {
  beforeAll(() => { stubGridLayout(); });

  afterEach(() => { vi.unstubAllGlobals(); });

  beforeEach(() => {
    stubDesktopViewport();
    getMatchAvailabilityMock.mockReset();
    getMatchAvailabilityMock.mockResolvedValue(buildAggregate());
  });

  function renderSection() {
    return renderWithProviders(
      <SchedulingAvailability
        lineupId={3}
        matchId={9}
        slots={[]}
        readOnly
        onPrefill={() => {}}
      />,
    );
  }

  it('requests the displayed week on mount', async () => {
    renderSection();

    await waitFor(() => expect(getMatchAvailabilityMock).toHaveBeenCalled());
    expect(getMatchAvailabilityMock).toHaveBeenCalledWith(3, 9, expectedWeeks().current);
  });

  it('re-queries with the next week when the grid is paged forward', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: /next week/i }));

    await waitFor(() =>
      expect(getMatchAvailabilityMock).toHaveBeenCalledWith(3, 9, expectedWeeks().next),
    );
  });
});
