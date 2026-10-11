/**
 * Event page calendar line + Add to calendar + Calendars send settings
 * (ROK-1596) — desktop, mobile and tablet projects (tablet takes the phone path).
 *
 * No live Google. DEMO_MODE seeds:
 *   - `POST /admin/test/calendar/seed-connection {userId, writeEnabled:true}` →
 *     a write-enabled `demo-fake:` connection for this project's viewer;
 *   - `POST /admin/test/calendar/seed-link {userId,eventId,state,connectionId}` →
 *     a synced link + a Fake copy on THAT connection, without the queue.
 *
 * The projects run at the same time against one DB, so each one drives its OWN
 * fixture user (`seed-fixture-user` slot per project) — never the shared admin.
 * Two projects seeding write connections for one user made the copy GET pick
 * either connection (review MAJOR 1). `beforeAll` also disconnects whatever a
 * crashed earlier run left on that user, so it owns exactly one connection.
 * The "no connection" viewer is the slot-1 invitee, which never gets one.
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
/** A distinct fixture user per project (slots are only read for calendar state here). */
const VIEWER_SLOT_BY_PROJECT: Readonly<Record<string, number>> = { desktop: 4, mobile: 5, tablet: 6 };

interface Viewer { userId: number; jwt: string }

let token: string;
let viewer: Viewer;
let connectionId: number | null = null;
const eventIds: number[] = [];

async function seedViewer(project: string): Promise<Viewer> {
    const slot = VIEWER_SLOT_BY_PROJECT[project];
    if (slot === undefined) throw new Error(`no viewer slot for project "${project}": add one to VIEWER_SLOT_BY_PROJECT`);
    const res = (await apiPost(token, '/admin/test/seed-fixture-user', { slot })) as Partial<Viewer> | null;
    if (typeof res?.userId !== 'number' || typeof res.jwt !== 'string') throw new Error(`seed-fixture-user(slot ${slot}) returned no user`);
    return { userId: res.userId, jwt: res.jwt };
}

/** Disconnect every calendar the viewer has (leftovers of a crashed run). */
async function disconnectAll(jwt: string): Promise<void> {
    const overview = (await apiGet(jwt, '/users/me/calendars')) as { connections?: { id: number }[] } | null;
    for (const c of overview?.connections ?? []) await apiDelete(jwt, `/users/me/calendars/${c.id}`).catch(() => undefined);
}

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

/** The page as another user: overwrite `raid_ledger_token` on the app origin. */
async function signInAs(page: Page, jwt: string): Promise<void> {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('raid_ledger_token', t), jwt);
}

// The kill switch is GLOBAL and the projects share one DB: only ever turned
// ON (idempotent), never restored — see profile-calendars.smoke.spec.ts.
test.beforeAll(async ({}, testInfo) => {
    token = await getAdminToken();
    await apiPut(token, '/admin/settings/calendar-sync', { enabled: true });
    viewer = await seedViewer(testInfo.project.name);
    await disconnectAll(viewer.jwt);
    const conn = (await apiPost(token, '/admin/test/calendar/seed-connection', {
        userId: viewer.userId,
        accountLabel: `smoke-cal-${testInfo.project.name}-${Date.now()}@example.com`,
        writeEnabled: true,
        writeTarget: 'primary',
    })) as { id?: number };
    connectionId = conn.id ?? null;
    if (connectionId === null) throw new Error(`seed-connection returned no id: ${JSON.stringify(conn)}`);
});

test.afterAll(async () => {
    for (const id of eventIds.splice(0)) await apiDelete(token, `/events/${id}`).catch(() => undefined);
    if (viewer) await disconnectAll(viewer.jwt);
    connectionId = null;
});

test('synced copy → "On your Google Calendar" line with an Open link to the copy', async ({ page }, testInfo) => {
    const eventId = await createEvent(`smoke-cal-synced-${testInfo.project.name}-${Date.now()}`);
    await apiPost(viewer.jwt, `/events/${eventId}/signup`, {});
    const link = (await apiPost(token, '/admin/test/calendar/seed-link', {
        userId: viewer.userId,
        eventId,
        state: 'synced',
        connectionId,
    })) as { linkId?: number };
    expect(typeof link.linkId, `seed-link body: ${JSON.stringify(link)}`).toBe('number');

    await signInAs(page, viewer.jwt);
    await page.goto(`/events/${eventId}`);
    const line = page.getByTestId('event-calendar-line');
    await expect(line).toContainText('On your Google Calendar');
    const open = line.getByRole('link', { name: 'Open' });
    await expect(open).toHaveAttribute('href', /^https:\/\/www\.google\.com\/calendar\/event\?eid=/);
    await expect(open).toHaveAttribute('target', '_blank');
    await expect(line.getByTestId('add-to-calendar')).toHaveCount(0);
});

test('sign up in the UI → "Added to Google Calendar" toast → Undo → the line falls back to Add to calendar', async ({ page }, testInfo) => {
    const eventId = await createEvent(`smoke-cal-undo-${testInfo.project.name}-${Date.now()}`);
    await signInAs(page, viewer.jwt);
    await page.goto(`/events/${eventId}`);
    const join = page.getByRole('button', { name: /^(Join Event|Sign Up for Event)$/ }).first();
    await join.scrollIntoViewIfNeeded();
    await join.click();

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Added to Google Calendar' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();

    const line = page.getByTestId('event-calendar-line');
    await expect(line.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
    await expect(line).not.toContainText('On your Google Calendar');
    const copy = (await apiGet(viewer.jwt, `/users/me/calendars/events/${eventId}`)) as { state?: string } | null;
    expect(copy?.state, `copy after Undo: ${JSON.stringify(copy)}`).toBe('suppressed');
});

test('no connection → Add to calendar menu (keyboard model) with Google, Outlook and Download .ics', async ({ page, request }, testInfo) => {
    const invitee = await getInviteeFixture();
    const eventId = await createEvent(`smoke-cal-add-${testInfo.project.name}-${Date.now()}`);
    await apiPost(invitee.jwt, `/events/${eventId}/signup`, {});

    await signInAs(page, invitee.jwt);
    await page.goto(`/events/${eventId}`);
    const line = page.getByTestId('event-calendar-line');
    const trigger = line.getByRole('button', { name: 'Add to calendar' });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const menu = line.getByRole('menu', { name: 'Add to calendar' });
    await expect(menu.getByRole('menuitem')).toHaveText(MENU_ITEMS);
    await expect(menu.getByRole('menuitem', { name: 'Google Calendar' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    const download = page.waitForEvent('download');
    await menu.getByRole('menuitem', { name: 'Download .ics' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.ics$/);

    const ics = await request.get(`${API_BASE}/events/${eventId}/ics`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()['content-type']).toMatch(/^text\/calendar/);
    expect(await ics.text()).toContain('BEGIN:VCALENDAR');
});

test('Calendars: K4 card (desktop) / K5 page (phone) saves the radio and the switch across a reload', async ({ page }, testInfo) => {
    await signInAs(page, viewer.jwt);
    const own = `[data-connection-id="${connectionId}"]`;
    let settingsUrl = CALENDARS;
    await page.goto(CALENDARS);
    if (isPhoneLayout(testInfo)) {
        const entry = page.locator(`[data-testid="send-events-entry"]${own}`);
        await entry.scrollIntoViewIfNeeded();
        await entry.click();
        settingsUrl = `${CALENDARS}/send/${connectionId}`;
        await expect(page).toHaveURL(new RegExp(`${settingsUrl}$`));
        const sub = page.getByTestId('send-events-page');
        await expect(sub.getByRole('heading', { name: 'Send my events' })).toBeVisible();
        await expect(sub.getByTestId('send-events-back')).toBeVisible();
    } else {
        await expect(page.locator(`[data-testid="send-events-entry"]${own}`)).toHaveCount(0);
    }
    const settings = () => page.locator(`[data-testid="send-events-settings"]${own}`);
    const dedicated = () => settings().getByRole('radio', { name: /Raid Ledger" calendar/ });
    const sendSwitch = () => settings().getByRole('switch', { name: 'Add events I sign up for' });
    await expect(sendSwitch()).toBeChecked();

    await dedicated().check();
    await expect(dedicated()).toBeChecked();
    await expect(dedicated()).toBeEnabled(); // save settled
    await page.goto(settingsUrl);
    await expect(dedicated()).toBeChecked();

    await sendSwitch().click();
    await expect(sendSwitch()).not.toBeChecked();
    await expect(sendSwitch()).toBeEnabled(); // save settled
    await page.goto(settingsUrl);
    await expect(sendSwitch()).not.toBeChecked();
});
