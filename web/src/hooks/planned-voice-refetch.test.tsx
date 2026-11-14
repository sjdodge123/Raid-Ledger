/**
 * A planned temporary voice channel ("opens 8:30 PM") must turn into the live
 * link on a page left open: the detail bundle refetches a little after it opens
 * and retries on a bounded interval. A live channel never polls.
 */
import type { JSX, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    plannedVoiceRefetchDelay,
    PLANNED_VOICE_GRACE_MS,
    PLANNED_VOICE_MAX_DELAY_MS,
    PLANNED_VOICE_MAX_RETRIES,
    PLANNED_VOICE_RETRY_MS,
} from './planned-voice-refetch';

const getEventDetail = vi.fn();
vi.mock('../lib/api-client', () => ({ getEventDetail: (id: number) => getEventDetail(id) }));

const { useEventDetail } = await import('./use-events');

/** Advance fake time inside act() so React Query's state updates don't warn. */
async function tick(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

const NOW = Date.parse('2026-11-13T20:00:00Z');
const OPENS_AT = '2026-11-13T20:30:00Z';
const OPENS_MS = Date.parse(OPENS_AT);
const planned = { channelId: null, channelName: 'Raid Night', guildId: null, plannedOpensAt: OPENS_AT };
const live = { channelId: '123', channelName: 'Raid Night', guildId: '9', plannedOpensAt: null };

describe('plannedVoiceRefetchDelay', () => {
    it('waits until a minute after the channel opens', () => {
        expect(plannedVoiceRefetchDelay(planned, NOW)).toBe(OPENS_MS + PLANNED_VOICE_GRACE_MS - NOW);
    });

    it('retries every minute after that, then gives up', () => {
        const first = OPENS_MS + PLANNED_VOICE_GRACE_MS;
        expect(plannedVoiceRefetchDelay(planned, first)).toBe(PLANNED_VOICE_RETRY_MS);
        const giveUp = first + PLANNED_VOICE_RETRY_MS * PLANNED_VOICE_MAX_RETRIES;
        expect(plannedVoiceRefetchDelay(planned, giveUp - 1)).toBe(PLANNED_VOICE_RETRY_MS);
        expect(plannedVoiceRefetchDelay(planned, giveUp)).toBe(false);
    });

    it('caps a far-away open time at one bounded timer', () => {
        const farAway = { ...planned, plannedOpensAt: '2027-06-01T00:00:00Z' };
        expect(plannedVoiceRefetchDelay(farAway, NOW)).toBe(PLANNED_VOICE_MAX_DELAY_MS);
    });

    it('never polls for a live, absent or malformed channel', () => {
        expect(plannedVoiceRefetchDelay(live, NOW)).toBe(false);
        expect(plannedVoiceRefetchDelay(null, NOW)).toBe(false);
        expect(plannedVoiceRefetchDelay({ ...planned, plannedOpensAt: 'not-a-date' }, NOW)).toBe(false);
    });
});

describe('useEventDetail planned-voice refetch', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        getEventDetail.mockReset();
    });
    afterEach(() => vi.useRealTimers());

    function renderDetail(): void {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
        renderHook(() => useEventDetail(7), { wrapper });
    }

    it('refetches after the planned channel opens and stops once it is live', async () => {
        getEventDetail.mockResolvedValueOnce({ voiceChannel: planned }).mockResolvedValue({ voiceChannel: live });
        renderDetail();
        await tick(0);
        expect(getEventDetail).toHaveBeenCalledTimes(1);

        await tick(OPENS_MS + PLANNED_VOICE_GRACE_MS - NOW - 1_000);
        expect(getEventDetail).toHaveBeenCalledTimes(1);

        await tick(1_000);
        expect(getEventDetail).toHaveBeenCalledTimes(2);

        await tick(PLANNED_VOICE_RETRY_MS * 5);
        expect(getEventDetail).toHaveBeenCalledTimes(2);
    });

    it('retries a still-planned response on the bounded interval', async () => {
        getEventDetail.mockResolvedValue({ voiceChannel: planned });
        renderDetail();
        await tick(OPENS_MS + PLANNED_VOICE_GRACE_MS - NOW);
        expect(getEventDetail).toHaveBeenCalledTimes(2);

        await tick(PLANNED_VOICE_RETRY_MS * (PLANNED_VOICE_MAX_RETRIES + 5));
        expect(getEventDetail).toHaveBeenCalledTimes(2 + PLANNED_VOICE_MAX_RETRIES);
    });

    it('does not refetch a live channel', async () => {
        getEventDetail.mockResolvedValue({ voiceChannel: live });
        renderDetail();
        await tick(2 * 60 * 60 * 1000);
        expect(getEventDetail).toHaveBeenCalledTimes(1);
    });
});
