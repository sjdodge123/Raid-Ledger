/** ROK-2185 item 3 — the Events tab's Recent list pages back through full history (operator ruling Q4 = A). */
import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage, GuildPastEventsPageDto, HubStatus, GuildRecentEventDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { GuildPastEvents } from './guild-past-events';
import { canPagePastEvents, type PastPagingAccess } from '../api/use-guild-past-events';

const PAST_URL = 'http://localhost:3000/guilds/7/events/past';

function ev(id: number): GuildRecentEventDto {
    return { id, title: `Past ${id}`, startTime: '2029-12-30T20:00:00.000Z', signedUp: 4, attended: 3 };
}

function range(from: number, count: number): GuildRecentEventDto[] {
    return Array.from({ length: count }, (_, i) => ev(from + i));
}

/**
 * Newest page repeats the two `raids.recent` rows, then 18 older; `c-1` and
 * `c-2` hold 20 each, `c-3` the last 3 — so click 1 needs two pages to reach
 * 20 new rows and later clicks leave rows waiting in the buffer.
 */
const PAGES: Record<string, GuildPastEventsPageDto> = {
    first: { events: [ev(1), ev(2), ...range(3, 18)], nextCursor: 'c-1' },
    'c-1': { events: range(21, 20), nextCursor: 'c-2' },
    'c-2': { events: range(41, 20), nextCursor: 'c-3' },
    'c-3': { events: range(61, 3), nextCursor: null },
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
const more = (): HTMLElement => screen.getByRole('button', { name: 'Show more' });
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => { requests = []; });

describe('GuildPastEvents', () => {
    it('asks nothing on open, then every Show more adds up to 20 new rows', async () => {
        servePages();
        renderList();
        await flush();
        expect(requests).toEqual([]);
        expect(rows()).toHaveLength(2);
        await userEvent.click(more());
        await waitFor(() => expect(rows()).toHaveLength(22));
        expect(requests, 'page 1 had only 18 new rows, so the same click fetched c-1').toEqual(['first', 'c-1']);
        await userEvent.click(more());
        await waitFor(() => expect(rows()).toHaveLength(42));
        await userEvent.click(more());
        await waitFor(() => expect(rows()).toHaveLength(62));
        expect(requests).toEqual(['first', 'c-1', 'c-2', 'c-3']);
        await userEvent.click(more());
        await waitFor(() => expect(rows()).toHaveLength(63));
        expect(requests, 'the last click is served from the buffer').toEqual(['first', 'c-1', 'c-2', 'c-3']);
        expect(screen.getByText('Past 63')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    });

    it('says so and drops Show more when a click finds nothing beyond raids.recent', async () => {
        server.use(http.get(PAST_URL, () => { requests.push('first'); return HttpResponse.json({ events: [ev(1), ev(2)], nextCursor: null }); }));
        renderList();
        await userEvent.click(more());
        expect(await screen.findByText('No older events.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
        expect(rows()).toHaveLength(2);
    });

    it('never asks the past route for a viewer it would refuse', async () => {
        servePages();
        renderList(false);
        expect(rows()).toHaveLength(2);
        await flush();
        expect(requests).toEqual([]);
        expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    });

    it('shows no error before a click; a failed click offers Retry, which recovers', async () => {
        servePages(true);
        renderList();
        await flush();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        await userEvent.click(more());
        const retryButton = await screen.findByRole('button', { name: 'Retry' });
        expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load older events.");
        servePages();
        await userEvent.click(retryButton);
        await waitFor(() => expect(rows()).toHaveLength(22));
        expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
});

describe('canPagePastEvents', () => {
    type Role = GuildPage['viewer']['role'];
    type Kind = GuildPage['guild']['kind'];
    const page = (role: Role, kind: Kind, status?: HubStatus): PastPagingAccess => ({
        viewer: { role },
        guild: { kind },
        ...(status ? { community: { status } } : {}),
    });

    it('lets members page, and visitors only on an open community hub (the overview read rule)', () => {
        expect(canPagePastEvents(page('member', 'wow_guild'))).toBe(true);
        expect(canPagePastEvents(page('visitor', 'wow_guild'))).toBe(false);
        expect(canPagePastEvents(page('visitor', 'game_community', 'active'))).toBe(true);
        expect(canPagePastEvents(page('visitor', 'game_community', 'archived'))).toBe(false);
    });
});
