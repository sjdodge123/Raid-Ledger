/**
 * MSW handlers for the Pelican plugin admin routes (ROK-121).
 *
 * Default: nothing stored (no URL, no key, tz inherited as UTC); the test
 * route answers `not_configured`. The PUT handler is stateless — it answers
 * with the default merged with the body, the full GET shape. Specs that need
 * state across calls override the routes with `server.use()`.
 */
import { http, HttpResponse } from 'msw';
import {
    PelicanConfigUpdateSchema,
    type PelicanConfig,
    type PelicanConfigUpdate,
    type PelicanTestResult,
} from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';
export const PELICAN_CONFIG_URL = `${API_BASE}/admin/plugins/pelican/config`;
export const PELICAN_TEST_URL = `${API_BASE}/admin/plugins/pelican/test`;

export const pelicanConfigFixture: PelicanConfig = {
    panelUrl: null,
    apiKeySet: false,
    defaultTimezone: 'UTC',
    timezoneInherited: true,
};

export const pelicanConfiguredFixture: PelicanConfig = {
    panelUrl: 'https://panel.example.test',
    apiKeySet: true,
    defaultTimezone: 'America/New_York',
    timezoneInherited: false,
};

function applyTimezone(current: PelicanConfig, tz: string | undefined): Pick<PelicanConfig, 'defaultTimezone' | 'timezoneInherited'> {
    if (tz === undefined) return { defaultTimezone: current.defaultTimezone, timezoneInherited: current.timezoneInherited };
    if (tz === '') return { defaultTimezone: 'UTC', timezoneInherited: true };
    return { defaultTimezone: tz, timezoneInherited: false };
}

/** Apply a PUT body the way the server does: omitted = unchanged, `''` = clear. */
export function applyPelicanUpdate(current: PelicanConfig, update: PelicanConfigUpdate): PelicanConfig {
    return {
        panelUrl: update.panelUrl === undefined ? current.panelUrl : update.panelUrl || null,
        apiKeySet: update.apiKey === undefined ? current.apiKeySet : update.apiKey !== '',
        ...applyTimezone(current, update.defaultTimezone),
    };
}

export const pelicanNotConfiguredResult: PelicanTestResult = {
    success: false,
    code: 'not_configured',
    message: 'Save a panel URL and client API key first.',
};

export const pelicanHandlers = [
    http.get(PELICAN_CONFIG_URL, () => HttpResponse.json(pelicanConfigFixture)),
    http.put(PELICAN_CONFIG_URL, async ({ request }) => {
        const parsed = PelicanConfigUpdateSchema.safeParse(await request.json());
        if (!parsed.success) {
            return HttpResponse.json({ message: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 });
        }
        return HttpResponse.json(applyPelicanUpdate(pelicanConfigFixture, parsed.data));
    }),
    http.post(PELICAN_TEST_URL, () => HttpResponse.json(pelicanNotConfiguredResult)),
];
