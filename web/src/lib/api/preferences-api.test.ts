import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchApiMock = vi.fn();
vi.mock('./fetch-api', () => ({
    fetchApi: (...args: unknown[]) => fetchApiMock(...args),
}));

import { updatePreference } from './preferences-api';

function setVisibility(state: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('updatePreference — unload flush (tech-debt 2706)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        fetchApiMock.mockReset();
        fetchApiMock.mockResolvedValue(undefined);
        setVisibility('visible');
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('sends a pending batch at once with keepalive on pagehide, and only once', async () => {
        const write = updatePreference('calendarView', 'week');
        window.dispatchEvent(new Event('pagehide'));

        expect(fetchApiMock).toHaveBeenCalledTimes(1);
        expect(fetchApiMock).toHaveBeenCalledWith('/users/me/preferences', {
            method: 'PATCH',
            body: JSON.stringify({ preferences: { calendarView: 'week' } }),
            keepalive: true,
        });
        await expect(write).resolves.toBeUndefined();

        vi.advanceTimersByTime(800);
        expect(fetchApiMock).toHaveBeenCalledTimes(1);
    });

    it('sends a pending batch when the tab becomes hidden', () => {
        void updatePreference('serverSchedules', true);
        setVisibility('hidden');
        document.dispatchEvent(new Event('visibilitychange'));

        expect(fetchApiMock).toHaveBeenCalledTimes(1);
        expect(fetchApiMock.mock.calls[0]?.[1]).toMatchObject({ keepalive: true });
    });

    it('sends nothing on pagehide when no write is pending', () => {
        void updatePreference('a', 1);
        vi.advanceTimersByTime(800);
        expect(fetchApiMock).toHaveBeenCalledTimes(1);
        expect(fetchApiMock.mock.calls[0]?.[1]).not.toHaveProperty('keepalive');

        window.dispatchEvent(new Event('pagehide'));
        expect(fetchApiMock).toHaveBeenCalledTimes(1);
    });
});
