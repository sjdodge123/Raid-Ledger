/**
 * Profile → Calendars smoke (ROK-1594) — desktop AND mobile projects.
 *
 * No live Google: a DEMO_MODE seed inserts a fake-provider connection for the
 * signed-in admin, the spec drives Manage → Disconnect → confirm on it, and
 * checks the `?error=` banner the OAuth callback lands on.
 *
 * Both projects run in parallel as the same admin, so every assertion is
 * scoped to the connection id THIS run seeded (`data-connection-id`).
 */
import { test, expect } from './base';
import { apiDelete, apiPost, apiPut, getAdminToken } from './api-helpers';

const PAGE = '/profile/gaming/calendars';
const SETTINGS = '/admin/settings/calendar-sync';

/** DEMO_MODE + admin: `{ accountLabel? }` → 201 `{ id }`, a `demo-fake:` row owned by the caller. */
async function seedConnection(token: string, accountLabel: string): Promise<number> {
    const res = (await apiPost(token, '/admin/test/calendar/seed-connection', { accountLabel })) as { id: number };
    expect(typeof res.id).toBe('number');
    return res.id;
}

let token: string;

// The kill switch is GLOBAL and desktop + mobile run in parallel on one DB, so
// it is only ever turned ON (idempotent) and never restored: a per-project
// afterAll would switch it off under the other project. Fleet/CI envs are disposable.
test.beforeAll(async () => {
    token = await getAdminToken();
    await apiPut(token, SETTINGS, { enabled: true });
});

test('connected card → Manage → Disconnect → confirm removes the connection', async ({ page }, testInfo) => {
    const label = `smoke-${testInfo.project.name}-${Date.now()}@example.com`;
    const id = await seedConnection(token, label);
    try {
        await page.goto(PAGE);
        const card = page.locator(`[data-testid="calendar-connection-card"][data-connection-id="${id}"]`);
        await expect(card.getByTestId('calendar-connection-status')).toHaveText(`Connected · ${label}`);
        const manage = card.getByTestId('calendar-manage');
        // A long account label must truncate, not widen the card: a phone-width
        // grid blowout once pushed Manage off-screen where nothing could tap it.
        await manage.scrollIntoViewIfNeeded();
        await expect(manage).toBeInViewport({ ratio: 1 });
        await manage.click();
        // Desktop: a role=menu item; phone: a sheet row. Both carry the same testid.
        await page.getByTestId('calendar-disconnect').filter({ visible: true }).click();
        await page.getByTestId('calendar-disconnect-confirm').click();
        await expect(card).toHaveCount(0);
    } finally {
        await apiDelete(token, `/users/me/calendars/${id}`).catch(() => undefined);
    }
});

test('?error=state lands on an inline banner and the param is stripped', async ({ page }) => {
    await page.goto(`${PAGE}?error=state`);
    const banner = page.getByTestId('calendar-oauth-error');
    await expect(banner).toHaveAttribute('data-error-code', 'state');
    await expect(page).toHaveURL(/\/profile\/gaming\/calendars$/);
});
