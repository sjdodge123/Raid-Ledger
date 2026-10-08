/**
 * Admin → Integrations → Calendar Sync (ROK-1591). Drives the real panel, hook
 * and form against a stateful MSW server so every assertion is about the PUT
 * body that actually left the page and the GET shape that came back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { AdminCalendarSyncSettings, UpdateAdminCalendarSyncSettings } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import {
    CALENDAR_SYNC_SETTINGS_URL,
    applyCalendarSyncUpdate,
    calendarSyncSettingsFixture,
} from '../../test/mocks/calendar-sync-handlers';
import { CalendarSyncPanel } from '../../pages/admin/calendar-sync-panel';

vi.mock('../../hooks/use-auth', () => ({ getAuthToken: vi.fn(() => 'test-token') }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const GOOGLE_SAVED: AdminCalendarSyncSettings = {
    ...calendarSyncSettingsFixture,
    google: { clientId: 'google-id.apps.googleusercontent.com', hasSecret: true },
};

/** A GET/PUT pair sharing state, recording every PUT body. */
function serveCalendarSync(initial: AdminCalendarSyncSettings): UpdateAdminCalendarSyncSettings[] {
    let state = initial;
    const puts: UpdateAdminCalendarSyncSettings[] = [];
    server.use(
        http.get(CALENDAR_SYNC_SETTINGS_URL, () => HttpResponse.json(state)),
        http.put(CALENDAR_SYNC_SETTINGS_URL, async ({ request }) => {
            const body = (await request.json()) as UpdateAdminCalendarSyncSettings;
            puts.push(body);
            state = applyCalendarSyncUpdate(state, body);
            return HttpResponse.json(state);
        }),
    );
    return puts;
}

async function renderPanel(initial: AdminCalendarSyncSettings) {
    const puts = serveCalendarSync(initial);
    renderWithProviders(<CalendarSyncPanel />);
    await screen.findByRole('switch', { name: 'Enable Calendar Sync' });
    return puts;
}

const googleSecret = () => screen.getByLabelText('Google client secret', { selector: 'input' });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('CalendarSyncPanel — kill switch', () => {
    it('defaults off and a toggle round-trip PUTs { enabled: true } and turns the card Online', async () => {
        const puts = await renderPanel(calendarSyncSettingsFixture);
        const toggle = screen.getByRole('switch', { name: 'Enable Calendar Sync' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByText('Offline')).toBeInTheDocument();

        fireEvent.click(toggle);

        await waitFor(() => expect(puts).toEqual([{ enabled: true }]));
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
        expect(screen.getByText('Online')).toBeInTheDocument();
    });
});

describe('CalendarSyncPanel — secrets', () => {
    it('never prefills a saved secret and shows a "Saved" chip instead', async () => {
        await renderPanel(GOOGLE_SAVED);
        expect(googleSecret()).toHaveValue('');
        expect(screen.getByTestId('calendar-sync-google-secret-saved')).toHaveTextContent('Saved');
        expect(screen.getByLabelText('Google client ID')).toHaveValue('google-id.apps.googleusercontent.com');
        expect(screen.queryByTestId('calendar-sync-microsoft-secret-saved')).not.toBeInTheDocument();
    });

    it('omits an untouched secret from the PUT body', async () => {
        const puts = await renderPanel(GOOGLE_SAVED);
        fireEvent.change(screen.getByLabelText('Google client ID'), { target: { value: 'rotated-id' } });
        save();

        await waitFor(() => expect(puts).toHaveLength(1));
        expect(puts[0]).toEqual({ google: { clientId: 'rotated-id' } });
        expect(puts[0]?.google).not.toHaveProperty('clientSecret');
        expect(puts[0]).not.toHaveProperty('microsoft');
        expect(puts[0]).not.toHaveProperty('enabled');
    });

    it('sends "" for an explicitly removed secret and drops the "Saved" chip', async () => {
        const puts = await renderPanel(GOOGLE_SAVED);
        fireEvent.click(screen.getByRole('button', { name: 'Remove saved Google client secret' }));
        save();

        await waitFor(() => expect(puts).toEqual([{ google: { clientSecret: '' } }]));
        await waitFor(() => expect(screen.queryByTestId('calendar-sync-google-secret-saved')).not.toBeInTheDocument());
    });

    it('sends a typed secret, then empties the box and shows "Saved"', async () => {
        const puts = await renderPanel(calendarSyncSettingsFixture);
        fireEvent.change(googleSecret(), { target: { value: 'typed-secret' } });
        save();

        await waitFor(() => expect(puts).toEqual([{ google: { clientSecret: 'typed-secret' } }]));
        await screen.findByTestId('calendar-sync-google-secret-saved');
        expect(googleSecret()).toHaveValue('');
    });
});

describe('CalendarSyncPanel — redirect URIs', () => {
    it('renders both redirect URIs read-only from the GET response', async () => {
        await renderPanel(calendarSyncSettingsFixture);
        const google = screen.getByRole('textbox', { name: 'Google redirect URI' });
        expect(google).toHaveValue(calendarSyncSettingsFixture.redirectUris.google);
        expect(google).toHaveAttribute('readonly');
        expect(screen.getByRole('textbox', { name: 'Microsoft redirect URI' }))
            .toHaveValue(calendarSyncSettingsFixture.redirectUris.microsoft);
    });

    it('Copy puts the redirect URI on the clipboard', async () => {
        await renderPanel(calendarSyncSettingsFixture);
        fireEvent.click(screen.getByRole('button', { name: 'Copy Microsoft redirect URI' }));
        await waitFor(() => expect(navigator.clipboard.writeText)
            .toHaveBeenCalledWith(calendarSyncSettingsFixture.redirectUris.microsoft));
    });
});
