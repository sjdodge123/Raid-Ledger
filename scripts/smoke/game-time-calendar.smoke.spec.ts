/**
 * My Game Time × a synced calendar (ROK-1595 S1 + S2) — desktop and mobile.
 *
 * No live Google. DEMO_MODE seeds, all as admin:
 *   - `POST /admin/test/calendar/seed-connection {userId}` → a `demo-fake:` row
 *     owned by this project's viewer;
 *   - `POST /admin/test/calendar/seed-busy {connectionId, readAccess:'granted',
 *     derive:true, blocks}` → one all-day block 14–15 days out (the PR-B derive
 *     turns it into a `source='calendar'` absence before the response) and one
 *     timed block 20:00–21:00 local TODAY (the S2 band for this week).
 *
 * Read mode, absences and game time are PER USER and the projects run at the
 * same time, so each worker's `beforeAll` seeds a FRESH member
 * (`seed-non-guild-user`, quiet DMs, onboarded via its own boot refresh) —
 * never the shared admin, whose game time other specs paint, and never a
 * fixture slot: an Ignore is permanent (`calendar_ignored_days`), so a reused
 * user would refuse to re-derive the away days on the next run or retry.
 * `afterAll` deletes the member, and with it its connection, blocks and ignores.
 *
 * Tablet takes the identical phone path as mobile (`isPhoneLayout`), so it
 * skips this file — see `PROJECTS`.
 */
import type { Browser, Page } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiDelete, apiGet, apiPost, apiPut, getAdminToken } from './api-helpers';
import { signInContextAs, signInOnboardedMember } from './browser-session';
import { isPhoneLayout } from './helpers';

const PAGE = '/profile/gaming/game-time';
/** Projects that run this file (tablet repeats mobile's phone path). */
const PROJECTS: ReadonlySet<string> = new Set(['desktop', 'mobile']);
const BUSY_HOUR = 20;

interface Viewer { userId: number; jwt: string }
interface AbsenceRow { id: number; startDate: string; endDate: string; source?: string }

let token: string;
let viewer: Viewer | null = null;
let connectionId: number | null = null;

/** Local `YYYY-MM-DD`, `days` from today. */
function isoDaysOut(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today at `hour`:00 local, as an ISO instant. */
function todayAt(hour: number): string {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
}

/** The display day index (0 = Sunday) of today — `calendarBusy.dayOfWeek`'s convention. */
const TODAY = new Date().getDay();
const AWAY_FIRST = isoDaysOut(14);
const AWAY_LAST = isoDaysOut(15);

/** `PUT /users/me/calendars/settings` answers 204 No Content — assert the status, never parse a body. */
async function putReadSettings(jwt: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${API_BASE}/users/me/calendars/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(body),
    });
    expect(res.status, `PUT /users/me/calendars/settings: ${await res.text()}`).toBe(204);
}

async function calendarAbsences(jwt: string): Promise<AbsenceRow[]> {
    const res = (await apiGet(jwt, '/users/me/game-time/absences?tzOffset=0')) as { data?: AbsenceRow[] } | AbsenceRow[] | null;
    const rows = Array.isArray(res) ? res : (res?.data ?? []);
    return rows.filter((r) => r.source === 'calendar');
}

/** A fresh, onboarded member and its access JWT (from a throwaway context's boot refresh). */
async function seedViewer(browser: Browser): Promise<Viewer> {
    const user = (await apiPost(token, '/admin/test/seed-non-guild-user', { quietDms: true })) as { userId?: number };
    if (typeof user.userId !== 'number') throw new Error(`seed-non-guild-user: ${JSON.stringify(user)}`);
    const userId = user.userId;
    viewer = { userId, jwt: '' }; // claimed before anything can throw, so afterAll deletes it
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
        return { userId, jwt: await signInOnboardedMember(await context.newPage(), userId) };
    } finally {
        await context.close();
    }
}

test.beforeAll(async ({ browser }, testInfo) => {
    if (!PROJECTS.has(testInfo.project.name)) return; // tablet: skipped per test, see the header
    token = await getAdminToken();
    await apiPut(token, '/admin/settings/calendar-sync', { enabled: true });
    viewer = await seedViewer(browser);
    const jwt = viewer.jwt;
    await putReadSettings(jwt, { mode: 'both' });
    // Free 19:00–23:00 today, so the 20:00 busy hour overlaps a slot ("· 1h busy").
    await apiPut(jwt, '/users/me/game-time', {
        slots: [19, 20, 21, 22].map((hour) => ({ dayOfWeek: TODAY, hour })),
    });
    const conn = (await apiPost(token, '/admin/test/calendar/seed-connection', {
        userId: viewer.userId,
        accountLabel: `smoke-gtcal-${testInfo.project.name}-${Date.now()}@example.com`,
    })) as { id?: number };
    connectionId = conn.id ?? null; // claimed before any assertion so afterAll disconnects it
    if (connectionId === null) throw new Error(`seed-connection returned no id: ${JSON.stringify(conn)}`);
    const seeded = (await apiPost(token, '/admin/test/calendar/seed-busy', {
        connectionId,
        readAccess: 'granted',
        derive: true,
        blocks: [
            {
                start: new Date(`${AWAY_FIRST}T00:00:00`).toISOString(),
                end: new Date(`${isoDaysOut(16)}T00:00:00`).toISOString(),
                allDay: true, firstDate: AWAY_FIRST, lastDate: AWAY_LAST,
            },
            { start: todayAt(BUSY_HOUR), end: todayAt(BUSY_HOUR + 1) },
        ],
    })) as { inserted?: number };
    expect(seeded.inserted, `seed-busy body: ${JSON.stringify(seeded)}`).toBe(2);
    await expect
        .poll(async () => (await calendarAbsences(jwt)).some((r) => r.startDate === AWAY_FIRST), {
            timeout: 15_000, message: `the derive never produced a calendar absence starting ${AWAY_FIRST}`,
        })
        .toBe(true);
});

test.afterAll(async () => {
    if (viewer) await apiDelete(token, `/users/${viewer.userId}`).catch(() => undefined);
    viewer = null;
    connectionId = null;
});

test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!PROJECTS.has(testInfo.project.name), 'tablet renders the same phone layout mobile covers');
    if (!viewer) throw new Error('beforeAll seeded no viewer');
    await signInContextAs(page.context(), viewer.userId);
});

async function openGameTime(page: Page, phone: boolean): Promise<void> {
    await page.goto(PAGE);
    if (phone) {
        await expect(page.getByTestId('game-time-check-sheet')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('phone-week-editor')).toBeVisible();
    } else {
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('game-time-grid')).toBeVisible();
    }
}

/** Phone: the drawer's "I'm away" swap; desktop: the D1 card under the week. */
async function openAwayPanel(page: Page, phone: boolean) {
    if (phone) {
        await page.getByTestId('away-entry').click();
    } else {
        await page.getByTestId('profile-away-card').scrollIntoViewIfNeeded();
    }
    const panel = page.getByTestId('away-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    return panel;
}

test('S1: a synced away day is a quiet calendar row with Ignore, and Ignore removes it for good', async ({ page }, testInfo) => {
    const phone = isPhoneLayout(testInfo);
    const jwt = viewer?.jwt ?? '';
    await openGameTime(page, phone);
    const panel = await openAwayPanel(page, phone);

    await expect(panel.getByTestId('away-calendar-divider')).toContainText('From your calendars');
    const rows = panel.locator('[data-testid="away-row"][data-source="calendar"]');
    await expect(rows, 'exactly the one seeded all-day block should derive a calendar row').toHaveCount(1, { timeout: 15_000 });
    const row = rows.first();
    await expect(row.getByTestId('away-row-meta')).toHaveText('2 days · Google Calendar');
    await expect(row.getByTestId('away-row-ignore')).toBeVisible();
    await expect(row.getByTestId('away-row-remove'), 'a synced row must never offer Remove').toHaveCount(0);

    await row.getByTestId('away-row-ignore').click();
    await expect(rows).toHaveCount(0, { timeout: 10_000 });
    await expect
        .poll(async () => (await calendarAbsences(jwt)).some((r) => r.startDate === AWAY_FIRST), {
            timeout: 15_000, message: `the ignored calendar absence starting ${AWAY_FIRST} is still listed by the API`,
        })
        .toBe(false);

    // F-9: no Undo — and the row stays gone after a reload.
    await openGameTime(page, phone);
    const again = await openAwayPanel(page, phone);
    await expect(again.locator('[data-testid="away-row"][data-source="calendar"]')).toHaveCount(0);
});

test('S2: the "Busy · Google Calendar" band draws on today at 8 PM', async ({ page }, testInfo) => {
    const phone = isPhoneLayout(testInfo);
    await openGameTime(page, phone);
    if (phone) {
        const strip = page.getByTestId(`phone-week-strip-day-${TODAY}`);
        await strip.click();
        await expect(strip).toHaveAttribute('aria-current', 'date');
        await expect(page.getByTestId('phone-day-busy')).toHaveText('· 1h busy');
    }
    const band = page.getByTestId(`calendar-busy-band-${TODAY}-${BUSY_HOUR}`);
    await band.scrollIntoViewIfNeeded();
    await expect(band).toBeVisible({ timeout: 15_000 });
    await expect(band).toHaveText('Busy · Google Calendar');
    await expect(band).toHaveCSS('pointer-events', 'none');
    // Only today carries a band: the seed has no other timed block.
    await expect(page.locator('[data-testid^="calendar-busy-band-"]')).toHaveCount(1);
});
