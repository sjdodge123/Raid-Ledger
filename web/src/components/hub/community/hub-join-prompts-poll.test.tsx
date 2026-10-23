/**
 * ROK-1893 P1 — after a signup the API writes the hub join prompt in a
 * post-commit listener, so the event page polls the prompts query on a
 * bounded window instead of trusting one immediate refetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { HubJoinPrompt, HubJoinPromptList } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import {
    PROMPT_POLL_MS, PROMPT_WATCH_MS, promptPollInterval, useHubJoinPrompts, watchHubJoinPrompts,
} from './hub-join-prompts-api';

vi.mock('../../../lib/api-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../lib/api-client')>()),
    fetchApi: vi.fn(),
}));

const fetchMock = vi.mocked(fetchApi);
const EVENT_ID = 7;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const EMPTY: HubJoinPromptList = { items: [], inDiscordServer: true, discordServerInviteUrl: null };
const PROMPT: HubJoinPrompt = {
    id: 1, kind: 'suggest', hubId: 3, hubName: 'Hub', source: 'signup', sourceRef: EVENT_ID,
    createdAt: new Date(NOW).toISOString(),
};

function setup(watchEventId: number | undefined): QueryClient {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    if (watchEventId !== undefined) watchHubJoinPrompts(qc, watchEventId);
    renderHook(() => useHubJoinPrompts(true, watchEventId), { wrapper });
    return qc;
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('promptPollInterval', () => {
    it('polls inside the window until the event prompt arrives', () => {
        expect(promptPollInterval(NOW + 5_000, EMPTY, EVENT_ID, NOW)).toBe(PROMPT_POLL_MS);
        expect(promptPollInterval(NOW + 5_000, { items: [PROMPT] }, EVENT_ID, NOW)).toBe(false);
    });

    it('a prompt for another event does not stop the poll', () => {
        const other = { items: [{ ...PROMPT, sourceRef: EVENT_ID + 1 }] };
        expect(promptPollInterval(NOW + 5_000, other, EVENT_ID, NOW)).toBe(PROMPT_POLL_MS);
    });

    it('no watch, or a closed window, never polls', () => {
        expect(promptPollInterval(undefined, EMPTY, EVENT_ID, NOW)).toBe(false);
        expect(promptPollInterval(NOW, EMPTY, EVENT_ID, NOW)).toBe(false);
    });
});

describe('useHubJoinPrompts post-signup watch (fake timers)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        fetchMock.mockReset();
        fetchMock.mockResolvedValue(EMPTY);
    });
    afterEach(() => { vi.useRealTimers(); });

    it('refetches every second and stops as soon as the event prompt arrives', async () => {
        setup(EVENT_ID);
        await advance(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await advance(PROMPT_POLL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fetchMock.mockResolvedValue({ items: [PROMPT] });
        await advance(PROMPT_POLL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        await advance(4 * PROMPT_POLL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('gives up when the window closes with no prompt', async () => {
        setup(EVENT_ID);
        await advance(PROMPT_WATCH_MS + PROMPT_POLL_MS);
        const atClose = fetchMock.mock.calls.length;
        expect(atClose).toBeLessThanOrEqual(PROMPT_WATCH_MS / PROMPT_POLL_MS + 1);
        await advance(5 * PROMPT_POLL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(atClose);
    });

    it('without a watch (untagged event) it fetches once and never polls', async () => {
        setup(undefined);
        await advance(5 * PROMPT_POLL_MS);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
