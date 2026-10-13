/**
 * Profile → Calendars smoke (ROK-1594) — desktop AND mobile projects. Since
 * ROK-1780 the Calendars page renders inline on Profile → My Integrations.
 *
 * No live Google: a DEMO_MODE seed inserts a fake-provider connection for the
 * signed-in admin, the spec drives Manage → Disconnect → confirm on it, and
 * checks the `?error=` banner the OAuth callback lands on.
 *
 * Both projects run in parallel as the same admin, so every assertion is
 * scoped to the connection id THIS run seeded (`data-connection-id`).
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, apiPut, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { isPhoneLayout } from './helpers';

const PAGE = '/profile/integrations';
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
        // `seed-connection` never stamps `lastSyncedAt`, so this is the pre-sync
        // line; a read cron landing mid-test would flip it to the exact
        // `readStatusLine` copy, which is the only other value accepted.
        await expectStatus(card.getByTestId('calendar-connection-status'), [
            `Connected · ${label}`, ...syncedLines(!isPhoneLayout(testInfo)),
        ]);
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

// ---------------------------------------------------------------------------
// ROK-1595 — read sync (K2 switches below 1024px, K4 radio cards from 1024px)
//
// Read mode is PER USER and the projects run at the same time, so every read
// test drives a FRESH member (`seed-non-guild-user`, quiet DMs) signed in with
// its own session, never the shared admin. Persistence is proven by a reload.
// The member (and with it its connection, blocks and settings) is deleted by
// the admin in `finally`.
// ---------------------------------------------------------------------------

/** The exact `readStatusLine` copies once a sync has run (`web/src/lib/synced-ago.ts`). */
function syncedLines(desktop: boolean): string[] {
    const ages = ['just now', '1 min ago', '2 min ago'];
    return ages.map((ago) => (desktop ? `Synced ${ago}` : `Synced ${ago} · 1 calendar`));
}

async function expectStatus(status: ReturnType<Page['getByTestId']>, allowed: string[]): Promise<void> {
    await expect(async () => {
        expect(allowed, 'the connection status line').toContain((await status.textContent())?.trim() ?? '');
    }).toPass({ timeout: 10_000 });
}

interface Member { userId: number; connectionId: number }

/** A fresh member with one seeded connection; `readAccess` flips its read grant. */
async function seedMember(project: string, readAccess: 'granted' | 'missing'): Promise<Member> {
    const user = (await apiPost(token, '/admin/test/seed-non-guild-user', { quietDms: true })) as { userId?: number };
    if (typeof user.userId !== 'number') throw new Error(`seed-non-guild-user: ${JSON.stringify(user)}`);
    const member = { userId: user.userId, connectionId: -1 };
    try {
        const conn = (await apiPost(token, '/admin/test/calendar/seed-connection', {
            userId: member.userId, accountLabel: `smoke-read-${project}-${Date.now()}@example.com`,
        })) as { id?: number };
        if (typeof conn.id !== 'number') throw new Error(`seed-connection: ${JSON.stringify(conn)}`);
        member.connectionId = conn.id;
        const start = new Date(Date.now() + 3 * 86_400_000);
        const busy = (await apiPost(token, '/admin/test/calendar/seed-busy', {
            connectionId: conn.id, readAccess,
            blocks: [{ start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString() }],
        })) as { inserted?: number };
        expect(busy.inserted, `seed-busy body: ${JSON.stringify(busy)}`).toBe(1);
        return member;
    } catch (err) {
        await removeMember(member.userId);
        throw err;
    }
}

async function removeMember(userId: number): Promise<void> {
    await apiDelete(token, `/users/${userId}`).catch(() => undefined);
}

async function openAs(page: Page, member: Member) {
    // A fresh member has not onboarded, and AuthGuard would detour PAGE to the wizard.
    await signInOnboardedMember(page, member.userId);
    await page.goto(PAGE);
    // The read rules are per USER (one section for the page, not bound to a connection); the
    // member's own connection card proves the page is showing this member's account.
    await expect(page.locator(`[data-testid="calendar-connection-card"][data-connection-id="${member.connectionId}"]`))
        .toBeVisible({ timeout: 15_000 });
    const rules = page.getByTestId('calendar-read-rules');
    await expect(rules).toBeVisible({ timeout: 15_000 });
    // One account: the page switches are its on/off (F-2), so no per-card "Read this account".
    await expect(page.getByTestId('calendar-connection-read')).toHaveCount(0);
    return rules;
}

/** Phone: flip "Busy hours" off → mode `days`, which survives a reload. */
async function phoneSwitches(page: Page, member: Member): Promise<void> {
    let rules = await openAs(page, member);
    await expect(rules).toHaveAttribute('data-layout', 'switches');
    await expect(rules.getByRole('heading')).toHaveText('Read · when a calendar says you are busy');
    await expect(rules.getByRole('switch', { name: 'Whole days become away' })).toBeChecked();
    await expect(rules.getByRole('switch', { name: 'Busy hours become busy' })).toBeChecked();
    await expect(rules.getByTestId('calendar-read-look-ahead')).toContainText('4 weeks');
    const saved = page.waitForResponse((r) => r.url().endsWith('/users/me/calendars/settings') && r.request().method() === 'PUT');
    await rules.getByRole('switch', { name: 'Busy hours become busy' }).click();
    expect((await saved).status(), 'PUT /users/me/calendars/settings is 204 No Content').toBe(204);
    expect((await saved).request().postDataJSON(), 'hours off with days on is mode `days`').toEqual({ mode: 'days' });
    await page.reload();
    rules = page.getByTestId('calendar-read-rules');
    await expect(rules.getByRole('switch', { name: 'Busy hours become busy' })).not.toBeChecked({ timeout: 15_000 });
    await expect(rules.getByRole('switch', { name: 'Whole days become away' })).toBeChecked();
}

/** Desktop: three radio cards, Both selected; "Whole days only" survives a reload; picker inline. */
async function desktopCards(page: Page, member: Member): Promise<void> {
    const rules = await openAs(page, member);
    await expect(rules).toHaveAttribute('data-layout', 'cards');
    await expect(rules.getByRole('heading')).toHaveText('When a calendar says you are busy');
    for (const name of ['Whole days only', 'Busy hours only', 'Both (default)']) await expect(rules.getByRole('radio', { name })).toBeVisible();
    await expect(rules.getByRole('radio', { name: 'Both (default)' })).toBeChecked();
    await rules.getByRole('radio', { name: 'Whole days only' }).click();
    await expect(rules.getByRole('radio', { name: 'Whole days only' })).toBeChecked();
    await page.reload();
    await expect(page.getByTestId('calendar-read-rules')
        .getByRole('radio', { name: 'Whole days only' })).toBeChecked({ timeout: 15_000 });
    // K4 "Calendars to check": the Fake's primary calendar, checked (empty ids = primary), and
    // un-uncheckable while it is the only one ticked (F-5 last-uncheck guard).
    const picker = page.locator(`[data-testid="calendar-picker"][data-connection-id="${member.connectionId}"]`);
    await expect(picker).toContainText('Calendars to check');
    const primary = picker.locator('[data-testid="calendar-picker-option"][data-calendar-id="primary"]');
    // The Checkbox primitive spreads the testid + data attrs onto the native <input>, so the
    // locator IS the checkbox.
    await expect(primary).toBeChecked({ timeout: 15_000 });
    await expect(primary).toBeDisabled();
}

test('read rules: K2 switches on the phone layout, K4 radio cards + picker on desktop; changes persist', async ({ page }, testInfo) => {
    const member = await seedMember(testInfo.project.name, 'granted');
    try {
        if (isPhoneLayout(testInfo)) await phoneSwitches(page, member);
        else await desktopCards(page, member);
    } finally {
        await removeMember(member.userId);
    }
});

test('Sync now (Manage menu): first tap queues a sync, a second tap is throttled', async ({ page }, testInfo) => {
    // CI's default is 30s (playwright.config.ts) and the land-poll below alone may take 60s.
    test.setTimeout(120_000);
    const member = await seedMember(testInfo.project.name, 'granted');
    try {
        await openAs(page, member);
        const card = page.locator(`[data-testid="calendar-connection-card"][data-connection-id="${member.connectionId}"]`);
        const tapSyncNow = async (): Promise<void> => {
            await card.getByTestId('calendar-manage').click();
            // Desktop: a menu row; phone: a sheet row. Both carry the same testid.
            await page.getByTestId('calendar-sync-now').filter({ visible: true }).click();
        };
        await tapSyncNow();
        await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Syncing your calendar…' })).toBeVisible({ timeout: 10_000 });
        // The queued job stamps `lastSyncedAt` out of band: reload until the card says so.
        const desktop = !isPhoneLayout(testInfo);
        await expect(async () => {
            await page.reload();
            const status = card.getByTestId('calendar-connection-status');
            expect(syncedLines(desktop), 'status after Sync now').toContain((await status.textContent())?.trim() ?? '');
        }).toPass({ timeout: 60_000 }); // a queued BullMQ job on a shared fleet runner
        await tapSyncNow();
        await expect(page.locator('[data-sonner-toast]')
            .filter({ hasText: 'Synced a moment ago. Try again in a few minutes.' })).toBeVisible({ timeout: 10_000 });
    } finally {
        await removeMember(member.userId);
    }
});

test('no read grant: the read section is the "Grant read access" CTA, not the controls', async ({ page }, testInfo) => {
    const member = await seedMember(testInfo.project.name, 'missing');
    try {
        const rules = await openAs(page, member);
        const grant = rules.getByTestId('calendar-read-grant');
        await expect(grant).toContainText('Let Raid Ledger see when you are busy');
        await expect(grant.getByTestId('calendar-read-grant-button')).toHaveText('Grant read access');
        await expect(rules.getByRole('switch')).toHaveCount(0);
        await expect(rules.getByRole('radio')).toHaveCount(0);
        // No read → no Sync now in the Manage menu (F-4: it lives there only while reading).
        const card = page.locator(`[data-testid="calendar-connection-card"][data-connection-id="${member.connectionId}"]`);
        await card.getByTestId('calendar-manage').click();
        await expect(page.getByTestId('calendar-disconnect').filter({ visible: true })).toBeVisible();
        await expect(page.getByTestId('calendar-sync-now').filter({ visible: true })).toHaveCount(0);
    } finally {
        await removeMember(member.userId);
    }
});
