/** ROK-2342: a failed players query is a retryable error, never "No players found". */
import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import { PlayersPage } from './players-page';

const API_BASE = 'http://localhost:3000';

describe('PlayersPage — ROK-2342: failed load', () => {
    it('a 500 shows the error state instead of "No players found", and Try again refetches', async () => {
        let calls = 0;
        server.use(
            http.get(`${API_BASE}/users`, () => {
                calls += 1;
                return HttpResponse.json({ message: 'Boom' }, { status: 500 });
            }),
            http.get(`${API_BASE}/users/recent`, () => HttpResponse.json({ data: [] })),
        );
        renderWithProviders(<PlayersPage />, { initialEntries: ['/players'] });
        expect(await screen.findByRole('heading', { name: "Couldn't load players" })).toBeInTheDocument();
        expect(screen.queryByText('No players found')).not.toBeInTheDocument();
        const before = calls;
        expect(before).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(calls).toBeGreaterThan(before));
    });
});

/** Fires as soon as the sentinel is observed, like a sentinel already in view. */
class InViewObserver {
    private readonly cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
    observe(el: Element): void {
        this.cb([{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
}

describe('PlayersPage — ROK-2342: a failed next page keeps the earlier pages', () => {
    const original = globalThis.IntersectionObserver;
    afterEach(() => { globalThis.IntersectionObserver = original; });

    it('page 2 failing keeps page 1 on screen and offers an inline retry for the next page', async () => {
        globalThis.IntersectionObserver = InViewObserver as unknown as typeof IntersectionObserver;
        let page2Calls = 0;
        server.use(
            http.get(`${API_BASE}/users`, ({ request }) => {
                if (new URL(request.url).searchParams.get('page') === '2') {
                    page2Calls += 1;
                    return HttpResponse.json({ message: 'Boom' }, { status: 500 });
                }
                return HttpResponse.json({
                    data: [{ id: 1, username: 'FirstPagePlayer', avatar: null, discordId: null, steamLinked: false }],
                    meta: { total: 2, page: 1, limit: 1, hasMore: true },
                });
            }),
            http.get(`${API_BASE}/users/recent`, () => HttpResponse.json({ data: [] })),
        );
        renderWithProviders(<PlayersPage />, { initialEntries: ['/players'] });
        expect(await screen.findByRole('heading', { name: "Couldn't load more players" })).toBeInTheDocument();
        expect(screen.getAllByText('FirstPagePlayer').length).toBeGreaterThan(0);
        expect(screen.queryByRole('heading', { name: "Couldn't load players" })).not.toBeInTheDocument();
        const before = page2Calls;
        expect(before).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(page2Calls).toBeGreaterThan(before));
    });
});
