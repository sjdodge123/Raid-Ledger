/**
 * ROK-1774 wireframe smoke coverage. A DEMO_MODE dev route, so the bar is
 * behavioural, not visual: the page mounts with all five frames, the gate
 * redirects, and the "Server schedules" checkbox actually removes the layer
 * (a wireframe whose toggle does nothing would still pass a "mounts" test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { ServerScheduleWireframesPage } from '../ServerScheduleWireframesPage';
import { segmentsForDay } from '../server-schedule-mock';

const mockStatus = vi.fn();
vi.mock('../../../hooks/use-system-status', () => ({
  useSystemStatus: () => mockStatus(),
}));

beforeEach(() => {
  mockStatus.mockReturnValue({ data: { demoMode: true }, isLoading: false });
});

describe('ServerScheduleWireframesPage', () => {
  it('renders the filter, week, day, month and schedule frames', () => {
    renderWithProviders(<ServerScheduleWireframesPage />);
    for (const id of ['ss-panel-filter', 'ss-panel-week', 'ss-panel-day', 'ss-panel-month', 'ss-panel-schedule']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('draws bands, ticks and muted rows while the checkbox is on, and none once it is off', () => {
    renderWithProviders(<ServerScheduleWireframesPage />);
    const checkbox = screen.getByTestId('ss-filter-servers');
    expect(checkbox).toBeChecked();
    expect(screen.getAllByTestId('ss-window-band').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('ss-marker-tick').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('ss-list-server').length).toBeGreaterThan(0);
    fireEvent.click(checkbox);
    expect(screen.queryAllByTestId('ss-window-band')).toHaveLength(0);
    expect(screen.queryAllByTestId('ss-marker-tick')).toHaveLength(0);
    expect(screen.queryAllByTestId('ss-list-server')).toHaveLength(0);
    expect(screen.getAllByTestId('ss-event').length).toBeGreaterThan(0);
  });

  it('redirects away when DEMO_MODE is off', () => {
    mockStatus.mockReturnValue({ data: { demoMode: false }, isLoading: false });
    renderWithProviders(<ServerScheduleWireframesPage />);
    expect(screen.queryByTestId('ss-panel-week')).not.toBeInTheDocument();
  });
});

describe('segmentsForDay', () => {
  it('splits a window that crosses midnight into an evening piece and a next-day tail', () => {
    expect(segmentsForDay(4)).toEqual([{ serverId: 'minecraft', startMin: 1080, endMin: 1440, continued: false }]);
    expect(segmentsForDay(5)).toEqual([
      { serverId: 'minecraft', startMin: 1080, endMin: 1440, continued: false },
      { serverId: 'minecraft', startMin: 0, endMin: 120, continued: true },
    ]);
  });
});
