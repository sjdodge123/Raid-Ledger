/**
 * The resume-refresh batch guard drops refresh notifications while a refetch
 * batch runs (so two still-401 queries cannot restart each other). A batch
 * whose refetch never settles must still release the guard after
 * `REFETCH_BATCH_TIMEOUT_MS`, or every later refresh is dropped until reload.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { batchedRefetch, REFETCH_BATCH_TIMEOUT_MS } from './resume-refresh';

const never = (): Promise<void> => new Promise<void>(() => {});

let client: QueryClient;
beforeEach(() => {
    vi.useFakeTimers();
    client = new QueryClient();
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    client.clear();
});

describe('batchedRefetch guard', () => {
    it('drops notifications while a batch runs, and releases a batch that never settles after the timeout', async () => {
        const refetch = vi.spyOn(client, 'refetchQueries').mockImplementationOnce(never).mockResolvedValue(undefined);
        const notify = batchedRefetch(client);
        notify();
        notify();
        expect(refetch, 'a notification during a running batch is dropped').toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(REFETCH_BATCH_TIMEOUT_MS - 1);
        notify();
        expect(refetch, 'the guard holds until the timeout').toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        notify();
        expect(refetch, 'a hung batch must release the guard so the next refresh refetches').toHaveBeenCalledTimes(2);
    });

    it('a batch that settles releases the guard at once and leaves no timer behind', async () => {
        const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);
        const notify = batchedRefetch(client);
        notify();
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount(), 'the timeout is cleared when the batch settles').toBe(0);
        notify();
        expect(refetch, 'a settled batch releases the guard').toHaveBeenCalledTimes(2);
    });

    it('a timed-out batch that settles late does not release the NEXT batch\'s guard', async () => {
        let settleFirst: () => void = () => {};
        const late = new Promise<void>((resolve) => { settleFirst = resolve; });
        const refetch = vi.spyOn(client, 'refetchQueries')
            .mockImplementationOnce(() => late)
            .mockImplementationOnce(never)
            .mockResolvedValue(undefined);
        const notify = batchedRefetch(client);
        notify();
        await vi.advanceTimersByTimeAsync(REFETCH_BATCH_TIMEOUT_MS);
        notify();
        settleFirst();
        await vi.advanceTimersByTimeAsync(0);
        notify();
        expect(refetch, 'batch 2 still holds the guard').toHaveBeenCalledTimes(2);
    });
});
