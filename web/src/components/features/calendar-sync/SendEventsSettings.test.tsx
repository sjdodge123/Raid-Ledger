/**
 * "Send my events" (ROK-1596 W1, K4 desktop / K5 phone) against MSW: the
 * switch and the destination radios PATCH `write`, 409 `needs_consent` starts
 * Google with `intent=primary`, 409 `write_already_enabled` shows its copy,
 * the helper line per shell, and no tentative toggle anywhere.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { CalendarConnection } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    CALENDAR_CONNECTION_URL, GOOGLE_CONSENT_URL_FIXTURE, GOOGLE_OAUTH_START_URL, calendarConnectionFixture,
} from '../../../test/mocks/calendar-sync-handlers';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { SendEventsSettings } from './SendEventsSettings';
import { SEND_EVENTS_COPY as S } from './calendar-sync.copy';

const realMatchMedia = window.matchMedia;
const realLocation = window.location;

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

function spyAssign() {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...realLocation, assign } });
    return assign;
}

/** Records every PATCH body; answers with `status` + `{message: code}` when given. */
function capturePatches(status = 200, code?: string) {
    const bodies: unknown[] = [];
    server.use(http.patch(CALENDAR_CONNECTION_URL, async ({ request }) => {
        bodies.push(await request.json());
        if (status !== 200) return HttpResponse.json({ statusCode: status, message: code, error: 'Conflict' }, { status });
        return HttpResponse.json(calendarConnectionFixture);
    }));
    return bodies;
}

function renderSettings(over: Partial<CalendarConnection['write']> = {}, desktop = false) {
    setDesktop(desktop);
    const connection = { ...calendarConnectionFixture, write: { ...calendarConnectionFixture.write, ...over } };
    return render(
        <QueryClientProvider client={createTestQueryClient()}>
            <SendEventsSettings connection={connection} />
        </QueryClientProvider>,
    );
}

afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
});

describe('SendEventsSettings', () => {
    it('the switch PATCHes {write:{enabled:true}} when off, {write:{enabled:false}} when on', async () => {
        const bodies = capturePatches();
        const { unmount } = renderSettings({ enabled: false });
        const sw = screen.getByRole('switch', { name: S.switchLabel });
        expect(sw).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(sw);
        await waitFor(() => expect(bodies).toEqual([{ write: { enabled: true } }]));
        unmount();
        renderSettings({ enabled: true });
        fireEvent.click(screen.getByRole('switch', { name: S.switchLabel }));
        await waitFor(() => expect(bodies).toEqual([{ write: { enabled: true } }, { write: { enabled: false } }]));
    });

    it('the destination radios show the current target and PATCH the new one', async () => {
        const bodies = capturePatches();
        renderSettings({ enabled: true, target: 'dedicated' });
        expect(screen.getByRole('radio', { name: S.dedicated })).toBeChecked();
        fireEvent.click(screen.getByRole('radio', { name: S.primary }));
        await waitFor(() => expect(bodies).toEqual([{ write: { target: 'primary' } }]));
    });

    it('409 needs_consent starts Google with intent=primary and leaves for the consent URL', async () => {
        capturePatches(409, 'needs_consent');
        const intents: (string | null)[] = [];
        server.use(http.get(GOOGLE_OAUTH_START_URL, ({ request }) => {
            intents.push(new URL(request.url).searchParams.get('intent'));
            return HttpResponse.json({ url: GOOGLE_CONSENT_URL_FIXTURE });
        }));
        const assign = spyAssign();
        renderSettings({ enabled: true, target: 'dedicated' });
        fireEvent.click(screen.getByRole('radio', { name: S.primary }));
        await waitFor(() => expect(assign).toHaveBeenCalledWith(GOOGLE_CONSENT_URL_FIXTURE));
        expect(intents).toEqual(['primary']);
        expect(screen.queryByTestId('send-events-error')).toBeNull();
    });

    it('409 write_already_enabled shows its copy and starts no sign-in', async () => {
        capturePatches(409, 'write_already_enabled');
        const assign = spyAssign();
        renderSettings({ enabled: false });
        fireEvent.click(screen.getByRole('switch', { name: S.switchLabel }));
        expect(await screen.findByRole('alert')).toHaveTextContent(S.alreadyEnabled);
        expect(assign).not.toHaveBeenCalled();
    });

    it('any other failure shows the generic save copy', async () => {
        capturePatches(500, 'boom');
        renderSettings({ enabled: false });
        fireEvent.click(screen.getByRole('switch', { name: S.switchLabel }));
        expect(await screen.findByRole('alert')).toHaveTextContent(S.saveFailed);
    });

});

describe('SendEventsSettings — K4/K5 layout', () => {
    it('phone (K5): helper line describes the switch, the Stays-in-step note shows', () => {
        renderSettings();
        const helper = screen.getByTestId('send-events-helper');
        expect(helper).toHaveTextContent('New sign-ups show up within a minute');
        expect(screen.getByRole('switch', { name: S.switchLabel })).toHaveAttribute('aria-describedby', helper.id);
        expect(screen.getByText(S.phone.dedicated)).toBeInTheDocument();
        expect(screen.getByTestId('send-events-note')).toHaveTextContent(S.noteTitle);
    });

    it('desktop (K4): helper line "To Google Calendar", heading + two-way tag, no note', () => {
        renderSettings({}, true);
        expect(screen.getByTestId('send-events-helper')).toHaveTextContent('To Google Calendar');
        expect(screen.getByRole('heading', { name: S.heading })).toBeInTheDocument();
        expect(screen.getByText(S.tag)).toBeInTheDocument();
        expect(screen.getByText(S.desktop.primary)).toBeInTheDocument();
        expect(screen.queryByTestId('send-events-note')).toBeNull();
    });

    it.each([false, true])('renders no tentative toggle (desktop=%s): one switch, no "tentative" text', (desktop) => {
        renderSettings({ enabled: true }, desktop);
        expect(screen.getAllByRole('switch')).toHaveLength(1);
        expect(screen.queryByText(/tentative/i)).toBeNull();
        expect(screen.queryByRole('checkbox')).toBeNull();
    });
});
