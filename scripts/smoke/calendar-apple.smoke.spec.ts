/**
 * Apple iCloud calendar via CalDAV (ROK-1598 §4.2 P1–P3) — desktop AND mobile.
 *
 * No live iCloud, ever. The connect route is the one place the browser would
 * reach Apple, so the spec intercepts `POST /users/me/calendars/apple`: the
 * refused attempt answers `apple_auth_failed`, the accepted one seeds a DEMO
 * Apple row (`seed-connection {provider:'apple'}` — a `demo-fake:` subject the
 * registry routes to the Fake) and answers with that real row, so the sheet,
 * the toast and the overview refetch all run against the real app.
 *
 * The email + password typed here are format-valid dummies, never an Apple ID.
 *
 * Desktop and mobile run in parallel on one DB, so every test drives a FRESH
 * member (its own context via the `page` fixture) and deletes it in `finally`.
 */
import type { Page, Route } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, apiPut, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { isPhoneLayout } from './helpers';

const PAGE = '/profile/integrations';
const SETTINGS = '/admin/settings/calendar-sync';
const APPLE_ROUTE = '**/users/me/calendars/apple';
/** Format-valid dummy (`xxxx-xxxx-xxxx-xxxx`); the route is intercepted, iCloud never sees it. */
const DUMMY_APP_PASSWORD = 'abcd-efgh-ijkl-mnop';

let adminToken: string;

// The kill switch is GLOBAL and both projects share the DB: only ever turned ON.
test.beforeAll(async () => {
    adminToken = await getAdminToken();
    await apiPut(adminToken, SETTINGS, { enabled: true });
});

interface Member { userId: number; jwt: string }
interface OverviewConnection { id: number; provider: string; status: string; accountLabel: string | null }

async function createMember(): Promise<number> {
    const user = (await apiPost(adminToken, '/admin/test/seed-non-guild-user', { quietDms: true })) as { userId?: number };
    if (typeof user.userId !== 'number') throw new Error(`seed-non-guild-user: ${JSON.stringify(user)}`);
    return user.userId;
}

async function removeMember(userId: number): Promise<void> {
    await apiDelete(adminToken, `/users/${userId}`).catch(() => undefined);
}

async function seedApple(userId: number, body: Record<string, unknown>): Promise<number> {
    const conn = (await apiPost(adminToken, '/admin/test/calendar/seed-connection', {
        userId, provider: 'apple', ...body,
    })) as { id?: number };
    if (typeof conn.id !== 'number') throw new Error(`seed-connection apple: ${JSON.stringify(conn)}`);
    return conn.id;
}

/** The member's own overview row for `id` (raw JSON — the route answer must be the real shape). */
async function overviewRow(jwt: string, id: number): Promise<Record<string, unknown> | undefined> {
    const overview = (await apiGet(jwt, '/users/me/calendars')) as { connections?: Array<Record<string, unknown>> } | null;
    return overview?.connections?.find((c) => c.id === id);
}

/** Poll the API after a seed: the page must never be asserted before the row is readable. */
async function expectSeeded(jwt: string, id: number, status: string): Promise<void> {
    await expect.poll(async () => {
        const row = (await overviewRow(jwt, id)) as OverviewConnection | undefined;
        return row ? `${row.provider}/${row.status}` : 'absent';
    }, { message: `connection ${id} in GET /users/me/calendars`, timeout: 15_000 }).toBe(`apple/${status}`);
}

async function openPage(page: Page, userId: number): Promise<Member> {
    const jwt = await signInOnboardedMember(page, userId);
    await page.goto(PAGE);
    return { userId, jwt };
}

const appleCard = (page: Page, id: number) =>
    page.locator(`[data-testid="calendar-connection-card"][data-connection-id="${id}"]`);

test('P1/P2: the Apple row opens the K3 sheet; bad format, refused password, then a connect lands the card', async ({ page }) => {
    const userId = await createMember();
    try {
        const { jwt } = await openPage(page, userId);
        const email = `smoke-apple-${userId}@icloud.example`;
        const row = page.getByTestId('calendar-provider-apple');
        await expect(row).toContainText('Apple iCloud', { timeout: 15_000 });
        await expect(page.getByTestId('calendar-provider-apple-hint')).toHaveText('Uses an app-specific password');
        await page.getByTestId('calendar-connect-apple').click();

        const sheet = page.getByRole('dialog', { name: 'Connect Apple Calendar' });
        await expect(sheet).toBeVisible();
        const help = sheet.getByRole('link', { name: 'How app-specific passwords work' });
        await expect(help).toHaveAttribute('href', 'https://support.apple.com/en-us/102654');
        await expect(help).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(help).toHaveAttribute('target', '_blank');

        const emailInput = sheet.getByTestId('apple-connect-email');
        const passwordInput = sheet.getByTestId('apple-connect-password');
        const submit = page.getByTestId('apple-connect-submit');
        await emailInput.fill(email);
        await passwordInput.fill('abcd');
        await passwordInput.blur();
        await expect(sheet).toContainText('App-specific passwords look like xxxx-xxxx-xxxx-xxxx.');
        await expect(submit, 'a bad format never reaches the server').toBeDisabled();

        // Attempt 1 is refused by "iCloud"; attempt 2 seeds the real row and answers with it.
        const bodies: unknown[] = [];
        let seededId: number | undefined;
        await page.route(APPLE_ROUTE, async (route: Route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            bodies.push(route.request().postDataJSON());
            if (bodies.length === 1) {
                return route.fulfill({ status: 400, json: { code: 'apple_auth_failed' } });
            }
            seededId = await seedApple(userId, { accountLabel: email });
            await expectSeeded(jwt, seededId, 'active');
            return route.fulfill({ status: 201, json: await overviewRow(jwt, seededId) });
        });

        await passwordInput.fill(DUMMY_APP_PASSWORD);
        await expect(submit).toBeEnabled();
        await submit.click();
        const alert = sheet.getByRole('alert');
        await expect(alert).toHaveText("Apple didn't accept that email and app-specific password. Check both, or create a new password.");
        await expect(passwordInput, 'a refused password is cleared').toHaveValue('');
        await expect(emailInput, 'the email is kept').toHaveValue(email);

        await passwordInput.fill(DUMMY_APP_PASSWORD);
        await submit.click();
        await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Apple Calendar connected' })).toBeVisible({ timeout: 10_000 });
        await expect(sheet).toBeHidden();
        expect(bodies, 'both attempts posted the typed email + password').toEqual([
            { email, appPassword: DUMMY_APP_PASSWORD }, { email, appPassword: DUMMY_APP_PASSWORD },
        ]);
        if (seededId === undefined) throw new Error('the accepted attempt never seeded a connection');
        const card = appleCard(page, seededId);
        await expect(card, 'the overview refetch shows the new Apple card').toBeVisible({ timeout: 15_000 });
        await expect(card).toHaveAttribute('data-provider', 'apple');
        await expect(card.getByTestId('calendar-connection-name')).toHaveText('Apple iCloud');
        // Several Apple IDs are allowed (Q15): the row stays and offers another one.
        await expect(page.getByTestId('calendar-provider-apple-hint')).toHaveText('Connect another Apple ID');
    } finally {
        await page.unroute(APPLE_ROUTE).catch(() => undefined);
        await removeMember(userId);
    }
});

test('P3: a revoked Apple password reads "Password was revoked · reconnect"; Fix reopens the sheet prefilled', async ({ page }) => {
    const userId = await createMember();
    try {
        const email = `smoke-revoked-${userId}@icloud.example`;
        const id = await seedApple(userId, { accountLabel: email, status: 'needs_reconnect' });
        const { jwt } = await openPage(page, userId);
        await expectSeeded(jwt, id, 'needs_reconnect');
        await page.reload();
        const card = appleCard(page, id);
        await expect(card.getByTestId('calendar-connection-status')).toHaveText('Password was revoked · reconnect', { timeout: 15_000 });
        // Apple read is always granted: no "Grant read access" on an Apple card.
        await expect(card.getByTestId('calendar-read-grant-button')).toHaveCount(0);
        await card.getByTestId('calendar-connection-fix').click();
        const sheet = page.getByRole('dialog', { name: 'Reconnect Apple Calendar' });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByTestId('apple-connect-email')).toHaveValue(email);
        await expect(sheet.getByTestId('apple-connect-password'), 'the password is never prefilled').toHaveValue('');
    } finally {
        await removeMember(userId);
    }
});

test('Send events: an Apple connection offers only the dedicated "Raid Ledger" calendar', async ({ page }, testInfo) => {
    const userId = await createMember();
    try {
        const id = await seedApple(userId, { writeEnabled: true, writeTarget: 'dedicated' });
        const { jwt } = await openPage(page, userId);
        await expectSeeded(jwt, id, 'active');
        await page.reload();
        await expect(appleCard(page, id)).toBeVisible({ timeout: 15_000 });
        const own = `[data-connection-id="${id}"]`;
        if (isPhoneLayout(testInfo)) {
            const entry = page.locator(`[data-testid="send-events-entry"]${own}`);
            await entry.scrollIntoViewIfNeeded();
            await entry.click();
            await expect(page).toHaveURL(new RegExp(`/profile/integrations/calendars/send/${id}$`));
        }
        const settings = page.locator(`[data-testid="send-events-settings"]${own}`);
        await expect(settings.getByRole('switch', { name: 'Add events I sign up for' })).toBeChecked({ timeout: 15_000 });
        await expect(settings.getByRole('radio')).toHaveCount(1);
        await expect(settings.getByRole('radio', { name: /Raid Ledger" calendar/ })).toBeChecked();
        await expect(settings.getByRole('radio', { name: 'My main calendar' }), 'hidden, not disabled (A9/Q3)').toHaveCount(0);
    } finally {
        await removeMember(userId);
    }
});
