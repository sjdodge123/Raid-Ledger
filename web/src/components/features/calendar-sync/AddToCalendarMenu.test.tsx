/**
 * "Add to calendar" menu (ROK-1596 S3 note): Google, Outlook and a one-off
 * `.ics` download; Esc closes it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { EVENT_ICS_URL } from '../../../test/mocks/calendar-sync-handlers';
import { AddToCalendarMenu } from './AddToCalendarMenu';
import { googleCalendarUrl, outlookCalendarUrl, type AddToCalendarEvent } from './add-to-calendar.helpers';
import { EVENT_CALENDAR_COPY as C } from './calendar-sync.copy';

const event: AddToCalendarEvent = {
    id: 42, title: 'Karazhan', startTime: '2026-09-26T00:00:00.000Z', endTime: '2026-09-26T03:00:00.000Z',
    url: 'http://localhost/events/42',
};

function openMenu() {
    render(<AddToCalendarMenu event={event} />);
    fireEvent.click(screen.getByRole('button', { name: C.addToCalendar }));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('AddToCalendarMenu', () => {
    it('is closed until the trigger is pressed, then offers the three entries in order', () => {
        render(<AddToCalendarMenu event={event} />);
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: C.addToCalendar }));
        expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([C.menuGoogle, C.menuOutlook, C.menuIcs]);
    });

    it('Google and Outlook open the prefilled provider page in a new tab and close the menu', () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: C.menuGoogle }));
        expect(open).toHaveBeenLastCalledWith(googleCalendarUrl(event), '_blank', 'noopener,noreferrer');
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: C.addToCalendar }));
        fireEvent.click(screen.getByRole('menuitem', { name: C.menuOutlook }));
        expect(open).toHaveBeenLastCalledWith(outlookCalendarUrl(event), '_blank', 'noopener,noreferrer');
    });

    it('Download .ics fetches GET /events/:id/ics and saves it as <title>.ics', async () => {
        const seen: string[] = [];
        server.use(http.get(EVENT_ICS_URL, ({ params }) => {
            seen.push(String(params.id));
            return new HttpResponse('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', { headers: { 'Content-Type': 'text/calendar' } });
        }));
        const createUrl = vi.fn(() => 'blob:ics');
        Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
        const names: string[] = [];
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            names.push(this.download);
        });
        openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: C.menuIcs }));
        await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
        expect(seen).toEqual(['42']);
        expect(names).toEqual(['Karazhan.ics']);
        expect(createUrl).toHaveBeenCalledTimes(1);
    });

    it('Esc closes the menu', () => {
        openMenu();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
