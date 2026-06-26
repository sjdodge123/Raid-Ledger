/**
 * Regression: scheduling-banner queryKey mismatch (TECH-DEBT 2026-05-13).
 *
 * useCreateSchedulingPoll invalidated ['scheduling-banner'] — a single-element
 * key that matches nothing — instead of the real banner key ['scheduling',
 * 'banner'] declared in use-scheduling.ts (BANNER_KEY). TanStack matches by
 * prefix-array equality, so the events-page scheduling banner never refreshed
 * after a standalone poll was created. This asserts the canonical key is
 * invalidated and the dead key is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const mockCreateSchedulingPoll = vi.fn();

vi.mock('../../lib/api-client', () => ({
  createSchedulingPoll: (...args: unknown[]) =>
    mockCreateSchedulingPoll(...args),
  getActiveStandalonePolls: vi.fn(),
}));

vi.mock('../../lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useCreateSchedulingPoll } from '../use-standalone-poll';

describe('useCreateSchedulingPoll — invalidates the scheduling banner', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockCreateSchedulingPoll.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  it('invalidates the canonical key ["scheduling","banner"] on success, not the dead key', async () => {
    mockCreateSchedulingPoll.mockResolvedValue({ matchId: 1, lineupId: 2 });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateSchedulingPoll(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({} as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['scheduling', 'banner'],
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ['scheduling-banner'],
    });
  });
});
