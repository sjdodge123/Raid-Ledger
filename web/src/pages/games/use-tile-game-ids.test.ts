/**
 * ROK-1453 — which game ids the games page batches interest for (Codex
 * follow-up).
 *
 * `WantToPlayProvider` answers `getInterest(gameId)` from ONE batch request and
 * returns the "not hearted, 0 people" default for any id it was not asked
 * about. In `?lfg=1` mode most tiles come from `GET /lfg` and appear in no
 * Discover row, so batching only the Discover/search ids renders every one of
 * them as an empty heart regardless of the truth.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { server } from '../../test/mocks/server';
import { lfgGroupsHandler } from '../../test/mocks/lfg-handlers';
import { buildLfgGroupSummary } from '../../test/factories/lfg';
import { ACCESS_TOKEN_KEY } from '../../lib/api/auth-storage-keys';
import { createTestQueryClient } from '../../test/render-helpers';
import { useTileGameIds } from './use-tile-game-ids';

/** Ids that came from the Discover rows / search results. */
const DISCOVER_IDS = [1, 2];
/** A game with a live intent that is in no carousel — the whole problem. */
const LFG_ONLY_ID = 909;

function wrapper(initialEntries: string[]) {
    const queryClient = createTestQueryClient();
    return ({ children }: { children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(MemoryRouter, { initialEntries }, children),
        );
}

beforeEach(() => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'test-token');
    server.use(
        lfgGroupsHandler([
            buildLfgGroupSummary({ gameId: LFG_ONLY_ID }),
            buildLfgGroupSummary({ gameId: DISCOVER_IDS[0] }),
        ]),
    );
});

describe('useTileGameIds', () => {
    it('adds the LFG game ids while the lfg view is on', async () => {
        const { result } = renderHook(() => useTileGameIds(DISCOVER_IDS), {
            wrapper: wrapper(['/games?lfg=1']),
        });

        await waitFor(() => {
            expect(result.current).toContain(LFG_ONLY_ID);
        });
        // The Discover ids are still batched, and the overlap is not doubled.
        expect(result.current).toEqual(
            expect.arrayContaining(DISCOVER_IDS),
        );
        expect(
            result.current.filter((id) => id === DISCOVER_IDS[0]),
        ).toHaveLength(1);
    });

    it('leaves the ids alone when the lfg view is off', async () => {
        const { result } = renderHook(() => useTileGameIds(DISCOVER_IDS), {
            wrapper: wrapper(['/games']),
        });

        await waitFor(() => {
            expect(result.current).toEqual(DISCOVER_IDS);
        });
    });
});
