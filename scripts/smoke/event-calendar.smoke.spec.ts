/**
 * Event page calendar line + Add to calendar + Calendars send settings
 * (ROK-1596 W3) — desktop AND mobile projects (tablet takes the phone path).
 *
 * No live Google. DEMO_MODE seeds:
 *   - `POST /admin/test/calendar/seed-connection {writeEnabled:true}` → a
 *     write-enabled `demo-fake:` connection for the signed-in admin;
 *   - `POST /admin/test/calendar/seed-link {userId,eventId,state:'synced'}` →
 *     a synced link + a Fake copy, so the line does not wait on the queue.
 * The "no connection" viewer is the smoke invitee fixture (a member with no
 * calendar connection), swapped in through `localStorage`.
 *
 * Projects run in parallel as the same admin, so each run seeds its OWN
 * connection + events and scopes Calendars-page assertions to that id.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import {
    API_BASE,
    apiDelete,
    apiGet,
    apiPost,
    apiPut,
    getAdminToken,
    getInviteeFixture,
} from './api-helpers';
import { isPhoneLayout } from './helpers';

const CALENDARS = '/profile/gaming/calendars';
const MENU_ITEMS = ['Google Calendar', 'Outlook', 'Download .ics'];

let token: string;
let adminId: number;
let connectionId: number | null = null;
const eventIds: number[] = [];

async function createEvent(title: string): Promise<number> {
    const start = new Date(Date.now() + 3 * 86_400_000);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    const event = (await apiPost(token, '/events', {
        title,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        maxAttendees: 10,
    })) as { id?: number };
    if (typeof event.id !== 'number') throw new Error(`POST /events returned no id: ${JSON.stringify(event)}`);
    eventIds.push(event.id); // claimed before any assertion so afterAll cleans it up
    return event.id;
}

/** The page as the invitee fixture: overwrite `raid_ledger_token` on the app origin. */
async function signInAs(page: Page, jwt: string): Promise<void> {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('raid_ledger_token', t), jwt);
}

// The kill switch is GLOBAL and both projects share one DB: only ever turned
// ON (idempotent), never restored — see profile-calendars.smoke.spec.ts.
test.beforeAll(async ({}, testInfo) => {
    token = await getAdminToken();
    adminId = ((await apiGet(token, '/auth/me')) as { id: number }).id;
    await apiPut(token, '/admin/settings/calendar-sync', { enabled: true });
    const conn = (await apiPost(token, '/admin/test/calendar/seed-connection', {
        accountLabel: `smoke-w3-${testInfo.project.name}-${Date.now()}@example.com`,
        writeEnabled: true,
    })) as { id?: number };
    connectionId = conn.id ?? null;
    if (connectionId === null) throw new Error(`seed-connection returned no id: ${JSON.stringify(conn)}`);
});

test.afterAll(async () => {
    for (const id of eventIds.splice(0)) await apiDelete(token, `/events/${id}`).catch(() => undefined);
    if (connectionId !== null) await apiDelete(token, `/users/me/calendars/${connectionId}`).catch(() => undefined);
    connectionId = null;
});

test('synced copy → "On your Google Calendar" line with an Open link to the copy', async ({ page }, testInfo) => {
    // The creator is auto-signed-up, so the admin is a signed-up viewer.
    const eventId = await createEvent(`smoke-w3-synced-${testInfo.project.name}-${Date.now()}`);
    const link = (await apiPost(token, '/admin/test/calendar/seed-link', {
        userId: adminId,
        eventId,
        state: 'synced',
    })) as { linkId?: number };
    expect(typeof link.linkId, `seed-link body: ${JSON.stringify(link)}`).toBe('number');

    await page.goto(`/events/${eventId}`);
    const line = page.getByTestId('event-calendar-line');
    await expect(line).toContainText('On your Google Calendar');
    const open = line.getByRole('link', { name: 'Open' });
    await expect(open).toHaveAttribute('href', /^https:\/\/www\.google\.com\/calendar\/event\?eid=/);
    await expect(open).toHaveAttribute('target', '_blank');
    await expect(line.getByTestId('add-to-calendar')).toHaveCount(0);
});

test('no connection → Add to calendar menu with Google, Outlook and Download .ics', async ({ page, request }, testInfo) => {
    const invitee = await getInviteeFixture();
    const eventId = await createEvent(`smoke-w3-add-${testInfo.project.name}-${Date.now()}`);
    await apiPost(invitee.jwt, `/events/${eventId}/signup`, {});

    await signInAs(page, invitee.jwt);
    await page.goto(`/events/${eventId}`);
    const line = page.getByTestId('event-calendar-line');
    const trigger = line.getByRole('button', { name: 'Add to calendar' });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const menu = line.getByRole('menu', { name: 'Add to calendar' });
    await expect(menu.getByRole('menuitem')).toHaveText(MENU_ITEMS);

    const download = page.waitForEvent('download');
    await menu.getByRole('menuitem', { name: 'Download .ics' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.ics$/);

    const ics = await request.get(`${API_BASE}/events/${eventId}/ics`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()['content-type']).toMatch(/^text\/calendar/);
    expect(await ics.text()).toContain('BEGIN:VCALENDAR');
});

test('Calendars page: K4 send card on desktop, K2 row → "Send my events" page on the phone layout', async ({ page }, testInfo) => {
    await page.goto(CALENDARS);
    if (!isPhoneLayout(testInfo)) {
        const card = page.locator(`[data-testid="send-events-settings"][data-connection-id="${connectionId}"]`);
        await expect(card).toBeVisible();
        await expect(card.getByTestId('send-events-switch')).toBeVisible();
        await expect(card.getByTestId('send-events-helper')).toBeVisible();
        await expect(page.locator(`[data-testid="send-events-entry"][data-connection-id="${connectionId}"]`)).toHaveCount(0);
        return;
    }
    const entry = page.locator(`[data-testid="send-events-entry"][data-connection-id="${connectionId}"]`);
    await entry.scrollIntoViewIfNeeded();
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`${CALENDARS}/send/${connectionId}$`));
    const sub = page.getByTestId('send-events-page');
    await expect(sub.getByRole('heading', { name: 'Send my events' })).toBeVisible();
    await expect(sub.getByTestId('send-events-switch')).toBeVisible();
    await expect(sub.getByTestId('send-events-back')).toBeVisible();
});
