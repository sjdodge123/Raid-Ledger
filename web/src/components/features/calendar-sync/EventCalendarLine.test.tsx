/**
 * S3 (ROK-1596 W2): the event page's calendar line per copy state, and the
 * sign-up toast whose Undo removes only that calendar copy (Q4).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import type { EventCalendarCopy } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    CALENDARS_OVERVIEW_URL, EVENT_CALENDAR_COPY_URL, EVENT_CALENDAR_UNDO_URL, calendarConnectionFixture, calendarsOverviewFixture,
} from '../../../test/mocks/calendar-sync-handlers';
import { toast } from '../../../lib/toast';
import { EventCalendarLine } from './EventCalendarLine';
import { useSignupCalendarToast } from './use-signup-calendar-toast';
import { EVENT_CALENDAR_COPY as C } from './calendar-sync.copy';

vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const event = { id: 42, title: 'Karazhan', startTime: '2026-09-26T00:00:00.000Z', endTime: '2026-09-26T03:00:00.000Z' };
const OPEN_URL = 'https://www.google.com/calendar/event?eid=abc';

function serveCopy(copy: EventCalendarCopy | null) {
    server.use(http.get(EVENT_CALENDAR_COPY_URL, () => HttpResponse.json(copy)));
}

function renderLine(isSignedUp = true) {
    const qc = createTestQueryClient();
    return render(<QueryClientProvider client={qc}><EventCalendarLine event={event} isSignedUp={isSignedUp} /></QueryClientProvider>);
}

beforeEach(() => {
    localStorage.setItem('raid_ledger_token', 'test-token');
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
});
afterEach(() => { localStorage.removeItem('raid_ledger_token'); });

describe('EventCalendarLine', () => {
    it('synced → "On your Google Calendar" with an Open link to the copy', async () => {
        serveCopy({ provider: 'google', state: 'synced', openUrl: OPEN_URL });
        renderLine();
        const line = await screen.findByTestId('event-calendar-line');
        await waitFor(() => expect(line).toHaveTextContent('On your Google Calendar'));
        const open = within(line).getByRole('link', { name: C.open });
        expect(open).toHaveAttribute('href', OPEN_URL);
        expect(open).toHaveAttribute('target', '_blank');
    });

    it('synced without an openUrl shows the line but no Open link', async () => {
        serveCopy({ provider: 'google', state: 'synced', openUrl: null });
        renderLine();
        await screen.findByText('On your Google Calendar');
        expect(screen.queryByRole('link', { name: C.open })).toBeNull();
    });

    it('pending and failed copies show their status line, never the menu', async () => {
        serveCopy({ provider: 'google', state: 'pending', openUrl: null });
        const { unmount } = renderLine();
        await screen.findByText(C.pending('Google Calendar'));
        expect(screen.queryByRole('button', { name: C.addToCalendar })).toBeNull();
        unmount();
        serveCopy({ provider: 'google', state: 'failed', openUrl: null });
        renderLine();
        await screen.findByText(C.failed('Google Calendar'));
    });

    it('not connected (null copy) → the "Add to calendar" menu', async () => {
        serveCopy(null);
        renderLine();
        expect(await screen.findByRole('button', { name: C.addToCalendar })).toBeInTheDocument();
    });

    it('an undone (suppressed) copy falls back to "Add to calendar"', async () => {
        serveCopy({ provider: 'google', state: 'suppressed', openUrl: null });
        renderLine();
        expect(await screen.findByRole('button', { name: C.addToCalendar })).toBeInTheDocument();
    });

    it('renders nothing for a viewer who is not signed up', () => {
        serveCopy({ provider: 'google', state: 'synced', openUrl: OPEN_URL });
        renderLine(false);
        expect(screen.queryByTestId('event-calendar-line')).toBeNull();
    });
});

describe('useSignupCalendarToast', () => {
    function setup(writeEnabled: boolean) {
        const connection = { ...calendarConnectionFixture, write: { enabled: writeEnabled, target: 'dedicated' as const } };
        server.use(http.get(CALENDARS_OVERVIEW_URL, () => HttpResponse.json(calendarsOverviewFixture({ connections: [connection] }))));
        const qc = createTestQueryClient();
        const invalidate = vi.spyOn(qc, 'invalidateQueries');
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
        const hook = renderHook(() => useSignupCalendarToast(42), { wrapper });
        return { hook, invalidate, qc };
    }

    it('with events sent to Google: "Signed up. Added to Google Calendar" + Undo → POST undo, then refetch the copy', async () => {
        const undone: string[] = [];
        server.use(http.post(EVENT_CALENDAR_UNDO_URL, ({ params }) => { undone.push(String(params.eventId)); return new HttpResponse(null, { status: 204 }); }));
        const { hook, invalidate, qc } = setup(true);
        await waitFor(() => expect(qc.getQueryData(['calendars', 'overview'])).toBeDefined());
        hook.result.current('confirmed');
        const [message, opts] = vi.mocked(toast.success).mock.calls[0] as [ReactNode, { action: { label: string; onClick: () => void } }];
        render(<>{message}</>);
        expect(screen.getByText('Added to Google Calendar').tagName).toBe('STRONG');
        expect(screen.getByText(/Signed up\./)).toBeInTheDocument();
        expect(opts.action.label).toBe('Undo');
        opts.action.onClick();
        await waitFor(() => expect(undone).toEqual(['42']));
        await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['calendars', 'event-copy', 42] }));
    });

    it('without a calendar that receives events: the plain sign-up toast, no Undo', async () => {
        const { hook, qc } = setup(false);
        await waitFor(() => expect(qc.getQueryData(['calendars', 'overview'])).toBeDefined());
        hook.result.current('confirmed');
        expect(toast.success).toHaveBeenCalledWith('Successfully signed up!', { description: "You're on the roster!" });
    });
});
