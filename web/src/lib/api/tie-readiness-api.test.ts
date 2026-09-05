/**
 * ROK-1374 — the readiness fetch treats "not yours to see" as "nothing to
 * show".
 *
 * `LineupVoteBanner` mounts this query for EVERY voting community lineup, so a
 * viewer who is not on the roster hits it constantly. A thrown query there
 * retries and then parks the page in a permanent error state over a response
 * that means "there is simply nothing here for you" — the same meaning 404
 * already carries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchWithAuth = vi.fn();

vi.mock('./fetch-api', () => ({
    fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
    fetchApi: vi.fn(),
}));

import { getTieReadiness } from './tie-readiness-api';

/** The slice of `Response` the wrapper reads. */
function response(status: number, body: unknown = {}): Response {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
    } as Response;
}

describe('getTieReadiness', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolves null on 404 — "no tie hold" is an ordinary state', async () => {
        mockFetchWithAuth.mockResolvedValue(response(404));
        await expect(getTieReadiness(7)).resolves.toBeNull();
    });

    it('resolves null on 403 — a non-roster viewer gets no card, not an error', async () => {
        mockFetchWithAuth.mockResolvedValue(
            response(403, { message: 'Forbidden resource' }),
        );
        await expect(getTieReadiness(7)).resolves.toBeNull();
    });

    it('still throws on a real failure', async () => {
        mockFetchWithAuth.mockResolvedValue(response(500, { message: 'boom' }));
        await expect(getTieReadiness(7)).rejects.toThrow('boom');
    });

    it('returns the payload on 200', async () => {
        mockFetchWithAuth.mockResolvedValue(
            response(200, { lineupId: 7, status: 'awaiting_pick' }),
        );
        await expect(getTieReadiness(7)).resolves.toEqual({
            lineupId: 7,
            status: 'awaiting_pick',
        });
    });
});
