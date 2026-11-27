/**
 * ROK-2371: Admin → Calendar Sync → Google block, "Allow sign-in with Google".
 * Drives the real panel + form against MSW so the assertions are about the
 * PUT body that left the page and the inline 400 that came back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { AdminCalendarSyncSettings, UpdateAdminCalendarSyncSettings } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { CALENDAR_SYNC_SETTINGS_URL, calendarSyncSettingsFixture } from '../../test/mocks/calendar-sync-handlers';
import { CalendarSyncPanel } from '../../pages/admin/calendar-sync-panel';
import { toast } from '../../lib/toast';

vi.mock('../../hooks/use-auth', () => ({ getAuthToken: vi.fn(() => 'test-token') }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SIGNIN_URIS = [
    'http://localhost:5173/api/auth/google/callback',
    'http://localhost:5173/api/auth/google/link/callback',
];
const SETTINGS: AdminCalendarSyncSettings = {
    ...calendarSyncSettingsFixture,
    googleSigninEnabled: false,
    redirectUris: { ...calendarSyncSettingsFixture.redirectUris, googleSignin: SIGNIN_URIS },
};

/** GET serves `SETTINGS`; PUT records the body and answers with `reply`. */
function serve(reply: (body: UpdateAdminCalendarSyncSettings) => Response): UpdateAdminCalendarSyncSettings[] {
    const puts: UpdateAdminCalendarSyncSettings[] = [];
    server.use(
        http.get(CALENDAR_SYNC_SETTINGS_URL, () => HttpResponse.json(SETTINGS)),
        http.put(CALENDAR_SYNC_SETTINGS_URL, async ({ request }) => {
            const body = (await request.json()) as UpdateAdminCalendarSyncSettings;
            puts.push(body);
            return reply(body);
        }),
    );
    return puts;
}

async function renderPanel() {
    renderWithProviders(<CalendarSyncPanel />);
    return screen.findByRole('switch', { name: 'Allow sign-in with Google' });
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
});

describe('Calendar Sync — Allow sign-in with Google', () => {
    it('shows the toggle (off), both sign-in redirect URIs and the 4-step checklist', async () => {
        serve(() => HttpResponse.json(SETTINGS));
        const toggle = await renderPanel();
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        for (const uri of SIGNIN_URIS) expect(screen.getByDisplayValue(uri)).toBeInTheDocument();
        const steps = within(screen.getByTestId('google-signin-checklist')).getAllByRole('listitem');
        expect(steps.map((li) => li.textContent)).toEqual([
            'Client ID + secret saved above.',
            'Both sign-in redirect URIs added to the OAuth client in Google Cloud.',
            'OAuth consent screen is In production (in “Testing” only listed test users can sign in).',
            'Turn on the toggle.',
        ]);
    });

    it('turning it on and saving PUTs { googleSigninEnabled: true } only', async () => {
        const puts = serve((body) => HttpResponse.json({ ...SETTINGS, ...body }));
        fireEvent.click(await renderPanel());
        save();
        await waitFor(() => expect(puts).toEqual([{ googleSigninEnabled: true }]));
        expect(toast.success).toHaveBeenCalledWith('Calendar Sync settings saved');
    });

    it('a 400 "Set the Google client first" shows inline under the toggle, not as a toast', async () => {
        serve(() => HttpResponse.json({ statusCode: 400, message: 'Set the Google client first' }, { status: 400 }));
        fireEvent.click(await renderPanel());
        save();
        expect(await screen.findByTestId('google-signin-error')).toHaveTextContent('Set the Google client first');
        expect(toast.error).not.toHaveBeenCalled();
    });
});
