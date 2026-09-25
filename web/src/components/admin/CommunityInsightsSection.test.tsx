/**
 * CommunityInsightsSection (ROK-1653 G3b): the churn threshold is the shared
 * Slider (a "%" readout that is also its aria-valuetext), the "saving…" note
 * lives in a polite live region beside it rather than inside the label, and
 * Refresh is the shared Button (aria-busy while pending, ruling 7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CommunityInsightsSection } from './CommunityInsightsSection';

const mocks = vi.hoisted(() => ({
    settings: { isLoading: false, data: { churnThresholdPct: 70 } },
    updateSettings: { mutate: vi.fn(), isPending: false },
    refresh: { mutate: vi.fn(), isPending: false },
}));

vi.mock('../../hooks/admin/use-community-insights-settings', () => ({
    useCommunityInsightsSettings: () => ({ settings: mocks.settings, updateSettings: mocks.updateSettings }),
}));

vi.mock('../../hooks/use-community-insights', () => ({
    useRefreshCommunityInsights: () => mocks.refresh,
}));

vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NAME = 'Churn risk threshold';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSettings.isPending = false;
    mocks.refresh.isPending = false;
});

afterEach(() => vi.useRealTimers());

describe('CommunityInsightsSection — threshold slider', () => {
    it('is a slider named "Churn risk threshold" with a % readout and its help text', () => {
        render(<CommunityInsightsSection />);
        const slider = screen.getByRole('slider', { name: NAME });
        expect(slider).toHaveValue('70');
        expect(slider).toHaveAttribute('aria-valuetext', '70%');
        expect(screen.getByTestId('slider-value')).toHaveTextContent('70%');
        expect(slider).toHaveAccessibleDescription(/flagged "at risk"/);
    });

    it('a change saves after the debounce and "saving…" shows in a live region, not in the name', () => {
        vi.useFakeTimers();
        const { rerender } = render(<CommunityInsightsSection />);
        const slider = screen.getByRole('slider', { name: NAME });
        const live = document.querySelector('[aria-live="polite"]');
        expect(live).not.toBeNull();
        expect(live).toHaveTextContent('');

        fireEvent.change(slider, { target: { value: '40' } });
        expect(screen.getByTestId('slider-value')).toHaveTextContent('40%');
        act(() => { vi.advanceTimersByTime(500); });
        expect(mocks.updateSettings.mutate).toHaveBeenCalledWith({ churnThresholdPct: 40 }, expect.any(Object));

        mocks.updateSettings.isPending = true;
        rerender(<CommunityInsightsSection />);
        expect(live).toHaveTextContent('saving…');
        expect(screen.getByRole('slider', { name: NAME })).toBe(slider);
    });
});

describe('CommunityInsightsSection — Refresh', () => {
    it('queues a refresh on click', () => {
        render(<CommunityInsightsSection />);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh insights now' }));
        expect(mocks.refresh.mutate).toHaveBeenCalledTimes(1);
    });

    it('is aria-busy + aria-disabled while pending and swallows a click', () => {
        mocks.refresh.isPending = true;
        render(<CommunityInsightsSection />);
        const refresh = screen.getByRole('button', { name: 'Refreshing…' });
        expect(refresh).toHaveAttribute('aria-busy', 'true');
        expect(refresh).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(refresh);
        expect(mocks.refresh.mutate).not.toHaveBeenCalled();
    });
});
