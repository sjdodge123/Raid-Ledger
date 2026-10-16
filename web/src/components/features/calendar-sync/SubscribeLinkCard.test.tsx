/**
 * Subscribe link (ROK-1599, K6) on the Calendars page against MSW: no feed →
 * Get link; a feed → Copy (https), Open (webcal:), Reset → confirm → POST →
 * the new link; a failed POST shows an inline alert. Both shells.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { CalendarsOverview } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    CALENDARS_OVERVIEW_URL, CALENDAR_FEED_URL, CALENDAR_FEED_RESET_URL_FIXTURE, CALENDAR_FEED_URL_FIXTURE,
    calendarsOverviewVariants, userCalendarHandlers,
} from '../../../test/mocks/calendar-sync-handlers';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { copyWithToast } from '../../../lib/clipboard';
import { setAccessToken, clearAccessToken } from '../../../lib/api/access-token-store';
import { CalendarsPage } from './CalendarsPage';
import { FEED_COPY as F, webcalUrl } from './calendar-feed.copy';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../../lib/clipboard', () => ({ copyWithToast: vi.fn().mockResolvedValue(true) }));

const realMatchMedia = window.matchMedia;

function setDesktop(desktop: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true, writable: true,
        value: (query: string) => ({
            matches: query === DESKTOP_MQ ? desktop : false, media: query, onchange: null,
            addEventListener: () => {}, removeEventListener: () => {},
            addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
        }),
    });
}

/** Overview starts as `initial`; a successful POST switches it to the returned feed (the server's state). */
function useStatefulFeed(initial: CalendarsOverview, postStatus = 200): { posts: () => number } {
    let overview = initial;
    let posts = 0;
    // server.use: the first matching handler wins, so these go before the stateless defaults.
    server.use(
        http.get(CALENDARS_OVERVIEW_URL, () => HttpResponse.json(overview)),
        http.post(CALENDAR_FEED_URL, () => {
            posts += 1;
            if (postStatus !== 200) return HttpResponse.json({ message: 'boom' }, { status: postStatus });
            overview = { ...overview, feed: { url: CALENDAR_FEED_RESET_URL_FIXTURE } };
            return HttpResponse.json({ url: CALENDAR_FEED_RESET_URL_FIXTURE });
        }),
        ...userCalendarHandlers(initial),
    );
    return { posts: () => posts };
}

function renderPage() {
    return render(
        <QueryClientProvider client={createTestQueryClient()}>
            <MemoryRouter><CalendarsPage /></MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    setAccessToken('test-token');
    setDesktop(true);
    vi.mocked(copyWithToast).mockClear();
});

afterEach(() => {
    clearAccessToken();
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
});

describe('SubscribeLinkCard — no feed', () => {
    it.each([true, false])('desktop=%s: intro + Get link, which POSTs and shows the link', async (desktop) => {
        setDesktop(desktop);
        const api = useStatefulFeed(calendarsOverviewVariants.available);
        renderPage();
        expect(await screen.findByText(F.intro)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: F.heading })).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('calendar-feed-get'));
        expect(await screen.findByDisplayValue(CALENDAR_FEED_RESET_URL_FIXTURE)).toBeInTheDocument();
        expect(api.posts()).toBe(1);
    });

    it('a failed Get link shows an inline alert', async () => {
        useStatefulFeed(calendarsOverviewVariants.available, 500);
        renderPage();
        fireEvent.click(await screen.findByTestId('calendar-feed-get'));
        expect(await screen.findByRole('alert')).toHaveTextContent(F.createFailed);
    });
});

describe('SubscribeLinkCard — with a feed', () => {
    it('shows the https link; Copy copies the https url; Open hands over the webcal: url', async () => {
        useStatefulFeed(calendarsOverviewVariants.withFeed);
        renderPage();
        expect(await screen.findByDisplayValue(CALENDAR_FEED_URL_FIXTURE)).toBeInTheDocument();
        expect(screen.getByText(F.linkLabel)).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('calendar-feed-copy'));
        expect(copyWithToast).toHaveBeenCalledWith(CALENDAR_FEED_URL_FIXTURE, { success: F.copied });
        const open = screen.getByRole('link', { name: F.open });
        expect(open).toBe(screen.getByTestId('calendar-feed-open'));
        expect(open.tagName).toBe('A');
        expect(open).toHaveAttribute(
            'href', 'webcal://raid.example.test/api/cal/u/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics',
        );
    });

    it('ROK-1599 Codex P1: the whole link block is blocked from Session Replay (anchor AND input)', async () => {
        useStatefulFeed(calendarsOverviewVariants.withFeed);
        renderPage();
        const input = await screen.findByDisplayValue(CALENDAR_FEED_URL_FIXTURE);
        const block = screen.getByTestId('calendar-feed-link');
        expect(block).toHaveAttribute('data-sentry-block');
        expect(screen.getByTestId('calendar-feed-open').closest('[data-sentry-block]')).toBe(block);
        expect(input.closest('[data-sentry-block]')).toBe(block);
    });

    it.each([true, false])('desktop=%s: Reset → confirm → POST → the new link', async (desktop) => {
        setDesktop(desktop);
        const api = useStatefulFeed(calendarsOverviewVariants.withFeed);
        renderPage();
        fireEvent.click(await screen.findByTestId('calendar-feed-reset'));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        const dialog = screen.getByTestId('calendar-feed-reset-dialog');
        expect(within(dialog).getByText(F.confirmBody)).toBeInTheDocument();
        expect(api.posts()).toBe(0);
        fireEvent.click(screen.getByTestId('calendar-feed-reset-confirm'));
        expect(await screen.findByDisplayValue(CALENDAR_FEED_RESET_URL_FIXTURE)).toBeInTheDocument();
        expect(api.posts()).toBe(1);
        // A closed BottomSheet stays mounted but drops role="dialog"; a closed Modal unmounts.
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('a failed reset keeps the dialog open with an inline alert and the old link', async () => {
        useStatefulFeed(calendarsOverviewVariants.withFeed, 500);
        renderPage();
        fireEvent.click(await screen.findByTestId('calendar-feed-reset'));
        fireEvent.click(await screen.findByTestId('calendar-feed-reset-confirm'));
        const dialog = screen.getByTestId('calendar-feed-reset-dialog');
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(F.resetFailed);
        expect(screen.getByDisplayValue(CALENDAR_FEED_URL_FIXTURE)).toBeInTheDocument();
    });

    it('never offers a tentative switch (OPERATOR-2)', async () => {
        useStatefulFeed(calendarsOverviewVariants.withFeed);
        renderPage();
        await screen.findByTestId('calendar-feed-link');
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });
});

describe('webcalUrl', () => {
    it('swaps http(s): for webcal: and leaves the rest', () => {
        expect(webcalUrl('https://a.test/api/cal/u/x.ics')).toBe('webcal://a.test/api/cal/u/x.ics');
        expect(webcalUrl('http://a.test/x.ics')).toBe('webcal://a.test/x.ics');
    });
});
