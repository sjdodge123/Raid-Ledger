/**
 * CommunityInsightsSection (ROK-1653 G3b): the churn threshold is the shared
 * Slider (a "%" readout that is also its aria-valuetext), the "saving…" note
 * lives in a polite live region beside it rather than inside the label, and
 * Refresh is the shared Button (aria-busy while pending, ruling 7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CommunityInsightsSection } from './CommunityInsightsSection';
import { toast } from '../../lib/toast';

type MutateOpts = { onSuccess: () => void; onError: (err: Error) => void };

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
    mocks.updateSettings.mutate.mockReset();
    mocks.settings.data = { churnThresholdPct: 70 };
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

describe('CommunityInsightsSection — server hydration and save', () => {
    it('hydrates the slider and its % readout from the server threshold', () => {
        mocks.settings.data = { churnThresholdPct: 55 };
        render(<CommunityInsightsSection />);
        const slider = screen.getByRole('slider', { name: NAME });
        expect(slider).toHaveValue('55');
        expect(screen.getByTestId('slider-value')).toHaveTextContent('55%');
    });

    it('toasts the saved value once the debounced save succeeds', () => {
        vi.useFakeTimers();
        mocks.updateSettings.mutate.mockImplementation((_vars: unknown, opts: MutateOpts) => opts.onSuccess());
        render(<CommunityInsightsSection />);
        fireEvent.change(screen.getByRole('slider', { name: NAME }), { target: { value: '45' } });
        expect(toast.success).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(500); });
        expect(toast.success).toHaveBeenCalledWith('Churn threshold saved → 45%');
    });

    it('a server refetch mid-edit does not clobber the local value; after the save the server value shows', () => {
        vi.useFakeTimers();
        let pending: MutateOpts | undefined;
        mocks.updateSettings.mutate.mockImplementation((_vars: unknown, opts: MutateOpts) => { pending = opts; });
        const { rerender } = render(<CommunityInsightsSection />);
        const slider = screen.getByRole('slider', { name: NAME });
        const readout = screen.getByTestId('slider-value');

        fireEvent.change(slider, { target: { value: '80' } });
        // The settings query resolves (or refetches) with a stale value before the debounce fires.
        mocks.settings.data = { churnThresholdPct: 40 };
        rerender(<CommunityInsightsSection />);
        expect(slider).toHaveValue('80');
        expect(readout).toHaveTextContent('80%');

        act(() => { vi.advanceTimersByTime(500); });
        expect(mocks.updateSettings.mutate).toHaveBeenCalledWith({ churnThresholdPct: 80 }, expect.any(Object));
        expect(slider).toHaveValue('80');

        // The hook invalidates the settings query before the caller's onSuccess runs.
        mocks.settings.data = { churnThresholdPct: 80 };
        act(() => pending?.onSuccess());
        expect(slider).toHaveValue('80');

        // With the local edit released, a later server value (e.g. another admin's save) shows.
        mocks.settings.data = { churnThresholdPct: 65 };
        rerender(<CommunityInsightsSection />);
        expect(slider).toHaveValue('65');
        expect(readout).toHaveTextContent('65%');
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
