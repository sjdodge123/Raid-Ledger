/**
 * K5 as its own phone page (ROK-1596 W1b): on phone K2's "Add events I sign up
 * for" row links to `/send/:id`, which renders the back crumb, the "Send my
 * events" heading and W1's settings; on desktop the K4 card stays inline and
 * there is no entry row.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    calendarConnectionFixture, calendarsOverviewVariants, userCalendarHandlers,
} from '../../../test/mocks/calendar-sync-handlers';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { CALENDARS_PATH } from '../../profile/profile-nav-data';
import { CalendarsPage } from './CalendarsPage';
import { SendEventsPage } from './SendEventsPage';
import { sendEventsPath } from './calendar-sync-row';
import { CALENDARS_COPY as C, SEND_EVENTS_COPY as S } from './calendar-sync.copy';
import { setAccessToken, clearAccessToken } from '../../../lib/api/access-token-store';

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

function renderAt(url: string) {
    server.use(...userCalendarHandlers(calendarsOverviewVariants.connected));
    return render(
        <QueryClientProvider client={createTestQueryClient()}>
            <MemoryRouter initialEntries={[url]}>
                <Routes>
                    <Route path={CALENDARS_PATH} element={<CalendarsPage />} />
                    <Route path={`${CALENDARS_PATH}/send/:connectionId`} element={<SendEventsPage />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    setAccessToken('test-token');
});

afterEach(() => {
    clearAccessToken();
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
});

describe('K5 Send my events — phone sub-page', () => {
    it('the phone entry row opens the sub-page', async () => {
        setDesktop(false);
        renderAt(CALENDARS_PATH);
        const entry = await screen.findByTestId('send-events-entry');
        expect(entry).toHaveAttribute('href', sendEventsPath(calendarConnectionFixture.id));
        expect(entry).toHaveTextContent(S.switchLabel);
        expect(entry).toHaveTextContent(S.entrySub.off); // fixture: write disabled
        expect(screen.queryByTestId('send-events-settings')).toBeNull();
        fireEvent.click(entry);
        expect(await screen.findByTestId('send-events-page')).toBeInTheDocument();
        expect(screen.queryByTestId('calendars-page')).toBeNull();
    });

    it('K2 order on phone: connection → "Write · send…" section with the row → "Add a calendar"', async () => {
        setDesktop(false);
        renderAt(CALENDARS_PATH);
        const entry = await screen.findByTestId('send-events-entry');
        const page = screen.getByTestId('calendars-page');
        const sections = Array.from(page.querySelectorAll('section > h3'), (h) => h.textContent);
        expect(sections).toEqual([C.connectedHeading, S.writeHeading, C.addHeading]);
        const writeSection = screen.getByRole('heading', { name: S.writeHeading }).closest('section');
        expect(writeSection).toContainElement(entry);
        const card = screen.getByTestId('calendar-connection-card');
        expect(card.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders the back crumb, the heading and W1 settings without the card heading', async () => {
        setDesktop(false);
        renderAt(sendEventsPath(calendarConnectionFixture.id));
        expect(await screen.findByTestId('send-events-settings')).toBeInTheDocument();
        const back = screen.getByTestId('send-events-back');
        expect(back).toHaveAttribute('href', CALENDARS_PATH);
        expect(back).toHaveTextContent(S.back);
        expect(screen.getByRole('heading', { level: 2, name: S.pageTitle })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: S.heading })).toBeNull();
        expect(screen.getByTestId('send-events-switch')).toBeInTheDocument();
        expect(screen.getAllByRole('switch')).toHaveLength(1);
    });

    it('the back crumb returns to Calendars', async () => {
        setDesktop(false);
        renderAt(sendEventsPath(calendarConnectionFixture.id));
        fireEvent.click(await screen.findByTestId('send-events-back'));
        expect(await screen.findByTestId('calendars-page')).toBeInTheDocument();
    });

    it('an unknown connection id shows the not-found line', async () => {
        setDesktop(false);
        renderAt(`${CALENDARS_PATH}/send/999999`);
        expect(await screen.findByTestId('send-events-not-found')).toHaveTextContent(S.notFound);
    });

    it('desktop keeps the inline K4 card and has no entry row', async () => {
        setDesktop(true);
        renderAt(CALENDARS_PATH);
        expect(await screen.findByTestId('send-events-settings')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: S.heading })).toBeInTheDocument();
        expect(screen.queryByTestId('send-events-entry')).toBeNull();
        expect(screen.queryByRole('heading', { name: S.writeHeading })).toBeNull();
    });
});
