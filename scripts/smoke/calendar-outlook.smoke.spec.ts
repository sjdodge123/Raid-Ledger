/**
 * Outlook / Microsoft 365 calendar (ROK-1597 §6 T23) — desktop AND mobile.
 *
 * No live Microsoft call, ever. The admin configures FAKE client credentials
 * through the real `PUT /admin/settings/calendar-sync`; Connect then navigates
 * to `login.microsoftonline.com`, which `page.route` answers with a stub page
 * so only the start URL is asserted. The connected card is a DEMO row
 * (`seed-connection {provider:'microsoft'}` — a `demo-fake:` subject the
 * registry routes to the Fake), so Disconnect never reaches Graph.
 *
 * The Microsoft config is GLOBAL and both projects share the DB, so it is only
 * ever SET (same fake values from both). "Hidden until configured" therefore
 * cannot be driven on the shared server without racing the other project: it
 * rewrites the real overview answer to `microsoft.available:false` instead
 * (the server flip itself is asserted through the API after the PUT).
 *
 * Every test drives a FRESH member and deletes it in `finally`.
 */
import type { Page, Route } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, apiPut, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

const PAGE = '/profile/integrations';
const SETTINGS = '/admin/settings/calendar-sync';
const OVERVIEW_ROUTE = '**/users/me/calendars';
const MS_LOGIN_ROUTE = 'https://login.microsoftonline.com/**';
/** Obviously fake app registration — never a real tenant or client. */
const FAKE_MS_CLIENT_ID = '00000000-0000-0000-0000-00000000f4ce';
const FAKE_MS_CLIENT_SECRET = 'fake-smoke-secret-not-real';

let adminToken: string;

test.beforeAll(async () => {
    adminToken = await getAdminToken();
    await apiPut(adminToken, SETTINGS, {
        enabled: true,
        microsoft: { clientId: FAKE_MS_CLIENT_ID, clientSecret: FAKE_MS_CLIENT_SECRET },
    });
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

function numberField(body: unknown, key: string, label: string): number {
    const n = isRecord(body) ? body[key] : undefined;
    if (typeof n !== 'number') throw new Error(`${label}: ${JSON.stringify(body)}`);
    return n;
}

async function createMember(): Promise<number> {
    const user: unknown = await apiPost(adminToken, '/admin/test/seed-non-guild-user', { quietDms: true });
    return numberField(user, 'userId', 'seed-non-guild-user');
}

async function removeMember(userId: number): Promise<void> {
    await apiDelete(adminToken, `/users/${userId}`).catch(() => undefined);
}

async function seedOutlook(userId: number, accountLabel: string): Promise<number> {
    const conn: unknown = await apiPost(adminToken, '/admin/test/calendar/seed-connection', {
        userId, provider: 'microsoft', accountLabel,
    });
    return numberField(conn, 'id', 'seed-connection microsoft');
}

async function overview(jwt: string): Promise<Record<string, unknown>> {
    const body: unknown = await apiGet(jwt, '/users/me/calendars');
    if (!isRecord(body)) throw new Error(`GET /users/me/calendars: ${JSON.stringify(body)}`);
    return body;
}

/** `providers.microsoft.available` as the member's API reports it. */
async function microsoftAvailable(jwt: string): Promise<string> {
    const providers = (await overview(jwt)).providers;
    const ms = isRecord(providers) ? providers.microsoft : undefined;
    return isRecord(ms) ? String(ms.available) : 'missing';
}

async function connectionState(jwt: string, id: number): Promise<string> {
    const list = (await overview(jwt)).connections;
    const row = Array.isArray(list) ? list.filter(isRecord).find((c) => c.id === id) : undefined;
    return row ? `${String(row.provider)}/${String(row.status)}` : 'absent';
}

const outlookCard = (page: Page, id: number) =>
    page.locator(`[data-testid="calendar-connection-card"][data-connection-id="${id}"]`);

test('T23a: the Outlook row stays hidden while the server reports Microsoft unavailable', async ({ page }) => {
    const userId = await createMember();
    try {
        await page.route(OVERVIEW_ROUTE, async (route: Route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            const res = await route.fetch();
            const json: unknown = await res.json();
            if (!isRecord(json) || !isRecord(json.providers)) return route.fulfill({ response: res });
            return route.fulfill({
                response: res,
                json: { ...json, providers: { ...json.providers, microsoft: { available: false } } },
            });
        });
        await signInOnboardedMember(page, userId);
        await page.goto(PAGE);
        // The Google row renders first, so the page has loaded the overview.
        await expect(page.getByTestId('calendar-provider-google')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('calendar-provider-microsoft')).toHaveCount(0);
    } finally {
        await page.unroute(OVERVIEW_ROUTE).catch(() => undefined);
        await removeMember(userId);
    }
});

test('T23b: once configured, the Outlook row offers Connect, which starts at login.microsoftonline.com', async ({ page }) => {
    const userId = await createMember();
    try {
        const jwt = await signInOnboardedMember(page, userId);
        await expect.poll(() => microsoftAvailable(jwt), {
            message: 'providers.microsoft.available after the admin PUT', timeout: 15_000,
        }).toBe('true');
        await page.goto(PAGE);
        const row = page.getByTestId('calendar-provider-microsoft');
        await expect(row).toContainText('Outlook / Microsoft 365', { timeout: 15_000 });
        await expect(page.getByTestId('calendar-provider-microsoft-hint')).toHaveText('Sign in with Microsoft');

        await page.route(MS_LOGIN_ROUTE, (route: Route) =>
            route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));
        await page.getByTestId('calendar-connect-microsoft').click();
        await page.waitForURL((u) => u.host === 'login.microsoftonline.com', { timeout: 15_000 });
        const url = new URL(page.url());
        expect(url.pathname).toBe('/common/oauth2/v2.0/authorize');
        expect(url.searchParams.get('client_id')).toBe(FAKE_MS_CLIENT_ID);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('prompt')).toBe('select_account');
        expect(url.searchParams.get('scope')).toBe('offline_access User.Read Calendars.ReadWrite');
    } finally {
        await page.unroute(MS_LOGIN_ROUTE).catch(() => undefined);
        await removeMember(userId);
    }
});

test('T23c: a seeded Outlook connection renders its card; Disconnect shows the Microsoft grant hint', async ({ page }) => {
    const userId = await createMember();
    try {
        const label = `smoke-outlook-${userId}@outlook.example`;
        const id = await seedOutlook(userId, label);
        const jwt = await signInOnboardedMember(page, userId);
        await expect.poll(() => connectionState(jwt, id), {
            message: `connection ${id} in GET /users/me/calendars`, timeout: 15_000,
        }).toBe('microsoft/active');
        await page.goto(PAGE);
        const card = outlookCard(page, id);
        await expect(card).toBeVisible({ timeout: 15_000 });
        await expect(card).toHaveAttribute('data-provider', 'microsoft');
        await expect(card.getByTestId('calendar-connection-name')).toHaveText('Outlook / Microsoft 365');

        const manage = card.getByTestId('calendar-manage');
        await manage.scrollIntoViewIfNeeded();
        await manage.click();
        // Desktop: a role=menu item; phone: a sheet row. Both carry the same testid.
        await page.getByTestId('calendar-disconnect').filter({ visible: true }).click();
        await expect(page.getByTestId('calendar-disconnect-microsoft-hint')).toHaveText(
            "You can also remove Raid Ledger from your Microsoft account's app permissions.",
        );
        await page.getByTestId('calendar-disconnect-confirm').click();
        await expect(card).toHaveCount(0, { timeout: 15_000 });
        await expect.poll(() => connectionState(jwt, id), { message: 'the row is gone server-side', timeout: 15_000 })
            .toBe('absent');
    } finally {
        await removeMember(userId);
    }
});
