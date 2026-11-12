/** ROK-2185 item 3 — the Events tab's Recent list pages back through full history (operator ruling Q4 = A). */
import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPastEventsPageDto, GuildRecentEventDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { GuildPastEvents } from './guild-past-events';

const PAST_URL = 'http://localhost:3000/guilds/7/events/past';

function ev(id: number): GuildRecentEventDto {
    return { id, title: `Past ${id}`, startTime: '2029-12-30T20:00:00.000Z', signedUp: 4, attended: 3 };
}

function range(from: number, count: number): GuildRecentEventDto[] {
    return Array.from({ length: count }, (_, i) => ev(from + i));
}

/** Newest page repeats the two `raids.recent` rows, then 18 older; the cursor page holds the last 5. */
const PAGES: Record<string, GuildPastEventsPageDto> = {
    first: { events: [ev(1), ev(2), ...range(3, 18)], nextCursor: 'c-1' },
    'c-1': { events: range(21, 5), nextCursor: null },
};

let requests: string[] = [];

function servePages(failFirst = false): void {
    server.use(http.get(PAST_URL, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        requests.push(cursor ?? 'first');
        if (failFirst && cursor === null) return HttpResponse.json({ message: 'boom' }, { status: 500 });
        const page = PAGES[cursor ?? 'first'];
        return page ? HttpResponse.json(page) : HttpResponse.json({ message: 'bad cursor' }, { status: 400 });
    }));
}

function renderList(canPage = true): void {
    renderWithProviders(<GuildPastEvents guildId={7} recent={[ev(1), ev(2)]} canPage={canPage} kind="wow_guild" />);
}

const rows = (): HTMLElement[] => screen.queryAllByTestId('guild-recent-event');

afterEach(() => { requests = []; });

describe('GuildPastEvents', () => {
    it('starts from raids.recent, then Show more appends pages until nextCursor is null', async () => {
        servePages();
        renderList();
        expect(rows()).toHaveLength(2);
        await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
        expect(rows()).toHaveLength(20);
        await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
        await waitFor(() => expect(rows()).toHaveLength(25));
        expect(screen.getByText('Past 25')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
        expect(requests).toEqual(['first', 'c-1']);
    });

    it('offers no Show more when the newest page holds nothing beyond raids.recent', async () => {
        server.use(http.get(PAST_URL, () => { requests.push('first'); return HttpResponse.json({ events: [ev(1), ev(2)], nextCursor: null }); }));
        renderList();
        await waitFor(() => expect(requests).toEqual(['first']));
        expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
        expect(rows()).toHaveLength(2);
    });

    it('never asks the past route for a viewer it would refuse (a non-member visitor)', async () => {
        servePages();
        renderList(false);
        expect(rows()).toHaveLength(2);
        await new Promise((r) => setTimeout(r, 0));
        expect(requests).toEqual([]);
        expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    });

    it('shows Retry when loading older events fails, and recovers on click', async () => {
        servePages(true);
        renderList();
        const retryButton = await screen.findByRole('button', { name: 'Retry' });
        expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load older events.");
        servePages();
        await userEvent.click(retryButton);
        await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
        expect(rows()).toHaveLength(20);
        expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
});
