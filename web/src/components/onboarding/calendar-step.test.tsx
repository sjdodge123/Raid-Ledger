/**
 * ROK-2022: the wizard's Calendar step against MSW — provider rows with the
 * overview's `available` passed through, Google's start carrying
 * `return=onboarding`, the connected card for a connected user, and the
 * OAuth return's banner / toast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';
import type { CalendarsOverview } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { createTestQueryClient } from '../../test/render-helpers';
import {
    GOOGLE_CONSENT_URL_FIXTURE, GOOGLE_OAUTH_START_URL, calendarsOverviewVariants, userCalendarHandlers,
} from '../../test/mocks/calendar-sync-handlers';
import { setAccessToken, clearAccessToken } from '../../lib/api/access-token-store';
import { CALENDARS_COPY as C, OAUTH_ERROR_COPY } from '../features/calendar-sync/calendar-sync.copy';
import { CALENDAR_STEP_COPY as S } from './calendar-step.copy';
import { CalendarStep } from './calendar-step';
import { Z_INDEX } from '../../lib/z-index';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function LocationProbe() {
    const loc = useLocation();
    return <span data-testid="location">{loc.pathname + loc.search}</span>;
}

function renderStep(overview: CalendarsOverview, url = '/onboarding') {
    server.use(...userCalendarHandlers(overview));
    return render(
        <QueryClientProvider client={createTestQueryClient()}>
            <MemoryRouter initialEntries={[url]}>
                <Routes>
                    <Route path="/onboarding" element={<><CalendarStep /><LocationProbe /></>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    setAccessToken('test-token');
    vi.mocked(toast.success).mockClear();
});
afterEach(() => clearAccessToken());

describe('CalendarStep (ROK-2022)', () => {
    it('no connection: header, Google + Apple rows, and the manage-later note', async () => {
        renderStep(calendarsOverviewVariants.available);
        expect(await screen.findByTestId('calendar-provider-google')).toBeInTheDocument();
        expect(screen.getByTestId('calendar-provider-apple')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: S.heading })).toBeInTheDocument();
        expect(screen.getByText(S.manageLater)).toBeInTheDocument();
        expect(screen.queryByTestId('calendar-step-connected'), 'no connection → no card').toBeNull();
    });

    it('passes `available` through: Google unconfigured → its Connect is disabled', async () => {
        renderStep(calendarsOverviewVariants.notConfigured);
        expect(await screen.findByTestId('calendar-connect-google'), 'Google not configured').toBeDisabled();
    });

    it('Google Connect starts the OAuth hop with return=onboarding', async () => {
        const realLocation = window.location;
        const assign = vi.fn();
        const queries: string[] = [];
        Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...realLocation, assign } });
        try {
            renderStep(calendarsOverviewVariants.available);
            server.use(http.get(GOOGLE_OAUTH_START_URL, ({ request }) => {
                queries.push(new URL(request.url).search);
                return HttpResponse.json({ url: GOOGLE_CONSENT_URL_FIXTURE });
            }));
            fireEvent.click(await screen.findByTestId('calendar-connect-google'));
            await waitFor(() => expect(assign).toHaveBeenCalledWith(GOOGLE_CONSENT_URL_FIXTURE));
            expect(queries, 'the callback must land back in the wizard').toEqual(['?return=onboarding']);
        } finally {
            Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
        }
    });

    it('a connected user sees the connected card instead of the provider rows', async () => {
        renderStep(calendarsOverviewVariants.connected);
        expect(await screen.findByTestId('calendar-connection-card')).toBeInTheDocument();
        expect(screen.getByText(S.connectedHeading)).toBeInTheDocument();
        expect(screen.queryByTestId('calendar-step-providers'), 'connected → no provider rows').toBeNull();
    });

    it('?error=denied (OAuth return): error banner above the provider rows, param stripped', async () => {
        renderStep(calendarsOverviewVariants.available, '/onboarding?error=denied');
        const banner = await screen.findByTestId('calendar-oauth-error');
        expect(banner).toHaveAttribute('data-error-code', 'denied');
        expect(banner).toHaveTextContent(OAUTH_ERROR_COPY.denied);
        expect(await screen.findByTestId('calendar-provider-google')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/onboarding$/));
    });

    it('?connected=google (OAuth return): one success toast and the connected card', async () => {
        renderStep(calendarsOverviewVariants.connected, '/onboarding?connected=google');
        expect(await screen.findByTestId('calendar-connection-card')).toBeInTheDocument();
        await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
        expect(screen.queryByTestId('calendar-oauth-error')).toBeNull();
    });

    it('switch off (a stale resume): says calendars are unavailable, no rows', async () => {
        renderStep(calendarsOverviewVariants.disabled);
        expect(await screen.findByText(C.unavailable)).toBeInTheDocument();
        expect(screen.queryByTestId('calendar-step-providers')).toBeNull();
        expect(screen.queryByTestId('calendar-connect-google')).toBeNull();
    });
});

describe('CalendarStep sheets stack above the wizard below 1024px (ROK-2022 Codex P1)', () => {
    /** The open sheet's fixed overlay layer, which carries the z-index (closed sheets are aria-hidden). */
    const layer = (): HTMLElement => {
        const parent = screen.getByRole('dialog').parentElement;
        if (!(parent instanceof HTMLElement)) throw new Error('the open sheet has no overlay layer');
        return parent;
    };

    it('Apple Connect opens its sheet on the stacked layer, above the z-50 wizard', async () => {
        renderStep(calendarsOverviewVariants.available);
        fireEvent.click(await screen.findByTestId('calendar-connect-apple'));
        expect(layer().style.zIndex, 'the Apple sheet must clear the wizard (MODAL_STACKED)').toBe(String(Z_INDEX.MODAL_STACKED));
    });

    it('the connected card opens its Manage sheet on the stacked layer', async () => {
        renderStep(calendarsOverviewVariants.connected);
        fireEvent.click(await screen.findByTestId('calendar-manage'));
        expect(layer().style.zIndex, 'the Manage sheet must clear the wizard (MODAL_STACKED)').toBe(String(Z_INDEX.MODAL_STACKED));
    });
});
