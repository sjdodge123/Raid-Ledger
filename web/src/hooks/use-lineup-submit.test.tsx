/**
 * use-lineup-submit tests (ROK-1296, AC2 click chain).
 *
 * Verifies the React-layer wire between the SubmitBar click and the
 * three new POST endpoints — including cache invalidation that triggers
 * the lineup detail refetch the SubmitBar consumer needs to flip to
 * the `post` kind.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../test/mocks/server';
import {
  useSubmitNominations,
  useSubmitVotes,
  useSubmitScheduling,
} from './use-lineup-submit';
import { LINEUPS_PREFIX } from './use-lineups';
import { createMockLineupDetail } from '../test/lineup-factories';

const API = 'http://localhost:3000';

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

describe('useSubmitNominations (AC2a click chain)', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = newClient();
    server.use(
      http.post(`${API}/lineups/:id/submit-nominations`, () =>
        HttpResponse.json(
          createMockLineupDetail({
            viewerSubmissions: {
              nominationsSubmittedAt: '2026-05-17T12:34:56Z',
              votesSubmittedAt: null,
            },
          }),
        ),
      ),
    );
  });

  it('POSTs to /lineups/:id/submit-nominations and returns the updated detail', async () => {
    const { result } = renderHook(() => useSubmitNominations(), {
      wrapper: makeWrapper(client),
    });

    let mutationResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      mutationResult = await result.current.mutateAsync({ lineupId: 42 });
    });

    expect(mutationResult?.viewerSubmissions.nominationsSubmittedAt).toBe(
      '2026-05-17T12:34:56Z',
    );
  });

  it('invalidates the LINEUPS_PREFIX cache so consumers refetch and the SubmitBar flips to post', async () => {
    // Seed a cached query under LINEUPS_PREFIX so we can observe the
    // invalidation after the mutation resolves.
    client.setQueryData([...LINEUPS_PREFIX, 'detail', 42], createMockLineupDetail());
    const { result } = renderHook(() => useSubmitNominations(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ lineupId: 42 });
    });

    await waitFor(() => {
      const state = client.getQueryState([...LINEUPS_PREFIX, 'detail', 42]);
      expect(state?.isInvalidated).toBe(true);
    });
  });
});

describe('useSubmitVotes (AC2b click chain)', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = newClient();
    server.use(
      http.post(`${API}/lineups/:id/submit-votes`, () =>
        HttpResponse.json(
          createMockLineupDetail({
            status: 'voting',
            viewerSubmissions: {
              nominationsSubmittedAt: '2026-05-17T00:00:00Z',
              votesSubmittedAt: '2026-05-17T12:00:00Z',
            },
          }),
        ),
      ),
    );
  });

  it('POSTs to /lineups/:id/submit-votes and returns viewerSubmissions.votesSubmittedAt', async () => {
    const { result } = renderHook(() => useSubmitVotes(), {
      wrapper: makeWrapper(client),
    });

    let mutationResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      mutationResult = await result.current.mutateAsync({ lineupId: 7 });
    });

    expect(mutationResult?.viewerSubmissions.votesSubmittedAt).toBe(
      '2026-05-17T12:00:00Z',
    );
  });
});

describe('useSubmitScheduling (AC2c click chain)', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = newClient();
    server.use(
      http.post(
        `${API}/lineups/:id/matches/:matchId/submit-scheduling`,
        () =>
          HttpResponse.json(
            createMockLineupDetail({
              status: 'decided',
              decidedGameId: 99,
            }),
          ),
      ),
    );
  });

  it('POSTs to /lineups/:id/matches/:matchId/submit-scheduling', async () => {
    const { result } = renderHook(() => useSubmitScheduling(), {
      wrapper: makeWrapper(client),
    });

    let mutationResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        lineupId: 7,
        matchId: 13,
      });
    });

    expect(mutationResult?.decidedGameId).toBe(99);
  });
});

describe('hook error path', () => {
  it('surfaces a 403 from submit-votes as a mutation error (e.g. phase mismatch)', async () => {
    const client = newClient();
    server.use(
      http.post(`${API}/lineups/:id/submit-votes`, () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'Submit not allowed in building phase',
            error: 'Forbidden',
          },
          { status: 403 },
        ),
      ),
    );

    const { result } = renderHook(() => useSubmitVotes(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ lineupId: 7 });
      } catch {
        /* expected — assertion below */
      }
    });

    expect(result.current.isError).toBe(true);
  });
});

