/**
 * ROK-2303 — on a PHONE (< 768px) Back from an event opened in the calendar's
 * Day view returns to that Day view, on the same date, at the same scroll.
 *
 * The fix: phones honour `?view=day|month` (no `view`, or `?view=week`, opens
 * Schedule, whose URL carries no `view`), and opening an event from the phone
 * Day view saves the WINDOW scroll offset (`.rbc-time-content` is overflow
 * visible on a phone, so the window scrolls), restored on the Back mount.
 * Desktop/tablet Back from Day view was already right and must stay so.
 *
 * Seed: one 60-minute event (no game, so nothing IGDB can rename) at 21:00 in
 * the app timezone, so on a phone its Day-view card sits below the fold and the
 * window has to scroll to reach it.
 *
 * ## Determinism
 * - Each project uses its own far-future UTC day (130 + 7 * index days ahead;
 *   calendar-day-view-overlap uses 90 + 7 * index), so concurrent projects and
 *   the near-term demo data never share the grid.
 * - The start is picked in the BROWSER's app timezone (`raid_ledger_timezone`,
 *   else the browser zone), the rule the grid zones events with.
 * - The id is claimed straight after the create; `finally` deletes it.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { isMobile } from './helpers';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LATE_HOUR = 21;
/** px the restored window offset may differ from the one saved at the tap. */
const SCROLL_TOLERANCE_PX = 8;

interface Seeded { id: number; title: string; date: string }

/** The app-timezone calendar day (yyyy-mm-dd) and hour (0-23) of `iso`. */
async function appDayAndHour(page: Page, iso: string): Promise<{ date: string; hour: number }> {
    return page.evaluate((at) => {
        const pref = localStorage.getItem('raid_ledger_timezone');
        const timeZone = pref && pref !== 'auto' ? pref : undefined;
        const d = new Date(at);
        const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(d));
        return { date, hour };
    }, iso);
}

/** A start instant at LATE_HOUR app time whose 1-hour event stays on one app-tz day. */
async function pickLateStart(page: Page, testInfo: TestInfo): Promise<{ start: number; date: string }> {
    const idx = Math.max(0, ['desktop', 'mobile', 'tablet'].indexOf(testInfo.project.name));
    const day = Math.floor(Date.now() / DAY_MS) * DAY_MS + (130 + 7 * idx) * DAY_MS;
    for (let h = 0; h < 48; h++) {
        const start = day + h * HOUR_MS;
        const at = await appDayAndHour(page, new Date(start).toISOString());
        const end = await appDayAndHour(page, new Date(start + HOUR_MS).toISOString());
        if (at.hour === LATE_HOUR && at.date === end.date) return { start, date: at.date };
    }
    throw new Error(`no start puts a 1-hour event at ${LATE_HOUR}:00 on one app-timezone day`);
}

/** Seed the late event; its id is pushed to `ids` before anything else can throw. */
async function seedLateEvent(token: string, page: Page, testInfo: TestInfo, title: string, ids: number[]): Promise<Seeded> {
    const { start, date } = await pickLateStart(page, testInfo);
    const created = (await apiPost(token, '/events', {
        title, maxAttendees: 10, startTime: new Date(start).toISOString(), endTime: new Date(start + HOUR_MS).toISOString(),
    })) as { id?: number } | null;
    if (typeof created?.id !== 'number') throw new Error(`POST /events: ${JSON.stringify(created)}`);
    ids.push(created.id);
    return { id: created.id, title, date };
}

const cardFor = (page: Page, title: string): Locator => page.locator('.rbc-event').filter({ hasText: title }).first();
const viewParam = (page: Page): string | null => new URL(page.url()).searchParams.get('view');
const dateParam = (page: Page): string | null => new URL(page.url()).searchParams.get('date');

/** Phone: open Schedule on `date`, then switch to Day with the segmented control. */
async function openPhoneDay(page: Page, date: string): Promise<void> {
    await page.goto(`/calendar?date=${date}`);
    await expect(page.locator('.schedule-view'), 'phone /calendar without ?view= opens Schedule').toBeVisible({ timeout: 15_000 });
    // A Day click during the page's mount-time URL writes can be lost — click until it sticks.
    const switcher = page.locator('[aria-label="Calendar view switcher"]');
    await expect(async () => {
        await switcher.getByRole('button', { name: 'Day' }).click({ timeout: 5_000 });
        await expect(page.locator('.rbc-time-view')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
    await expect.poll(() => viewParam(page), { message: 'phone Day view writes ?view=day' }).toBe('day');
}

/** Centre `card` in the window and return the window's scrollY. */
async function scrollCardToCentre(card: Locator): Promise<number> {
    return card.evaluate((el) => {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        return window.scrollY;
    });
}

/** Tap `card`, wait for its event page, then go Back. */
async function openEventAndGoBack(page: Page, card: Locator, s: Seeded): Promise<void> {
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/events/${s.id}(\\?|$)`));
    await expect(page.getByText(s.title).first()).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/calendar(\?|$)/);
}

test.describe('Calendar — Back from an event returns to the Day view (ROK-2303)', () => {
    test('phone: Back restores the Day view, its date and the scroll that showed the card', async ({ page, world }, testInfo) => {
        test.skip(!isMobile(testInfo), 'phone layout only (< 768px); wider viewports are the desktop test');
        const token = await getAdminToken();
        const ids: number[] = [];
        await page.goto('/calendar');
        await expect(page.locator('.schedule-view'), 'phone /calendar opens Schedule').toBeVisible({ timeout: 15_000 });
        expect(viewParam(page), 'Schedule carries no ?view= in the URL').toBeNull();
        try {
            const s = await seedLateEvent(token, page, testInfo, world.uid('rok-2303-late'), ids);
            await openPhoneDay(page, s.date);
            const card = cardFor(page, s.title);
            await expect(card).toBeVisible({ timeout: 15_000 });
            const savedY = await scrollCardToCentre(card);
            expect(savedY, `the ${LATE_HOUR}:00 card is below the fold, so the window had to scroll`).toBeGreaterThan(0);
            await expect(card).toBeInViewport();

            await openEventAndGoBack(page, card, s);

            await expect(page.locator('.schedule-view'), 'Back from a Day-view event must not land in Schedule').toHaveCount(0);
            await expect(page.locator('.rbc-time-view'), 'Back from a Day-view event shows the Day grid').toBeVisible({ timeout: 15_000 });
            expect(viewParam(page), 'Back URL keeps ?view=day').toBe('day');
            expect(dateParam(page), 'Back URL keeps the Day view date').toBe(s.date);
            await expect.poll(() => page.evaluate(() => window.scrollY), {
                message: `window scrollY after Back is within ${SCROLL_TOLERANCE_PX}px of ${savedY} (the offset at the tap)`, timeout: 10_000,
            }).toBeGreaterThanOrEqual(savedY - SCROLL_TOLERANCE_PX);
            const restoredY = await page.evaluate(() => window.scrollY);
            expect(restoredY, `window scrollY after Back is within ${SCROLL_TOLERANCE_PX}px of ${savedY}`).toBeLessThanOrEqual(savedY + SCROLL_TOLERANCE_PX);
            expect(restoredY, 'Back did not reset the window to the top').toBeGreaterThan(0);
            await expect(cardFor(page, s.title), 'the tapped card is on screen after Back').toBeInViewport();
        } finally {
            for (const id of ids) await apiDelete(token, `/events/${id}`);
        }
    });

    test('phone: a ?view=week deep link opens Schedule', async ({ page }, testInfo) => {
        test.skip(!isMobile(testInfo), 'phones offer no Week view; wider viewports honour it');
        await page.goto('/calendar?view=week');
        await expect(page.locator('.schedule-view'), 'phone ?view=week opens Schedule').toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.rbc-time-view'), 'no Week grid on a phone').toHaveCount(0);
        await expect.poll(() => viewParam(page), { message: 'Schedule drops ?view= from the URL' }).toBeNull();
    });

    test('desktop/tablet: Back from a Day-view event still returns to the Day view', async ({ page, world }, testInfo) => {
        test.skip(isMobile(testInfo), 'the phone flow is the test above');
        const token = await getAdminToken();
        const ids: number[] = [];
        await page.goto('/calendar');
        try {
            const s = await seedLateEvent(token, page, testInfo, world.uid('rok-2303-desk'), ids);
            await page.goto(`/calendar?view=day&date=${s.date}`);
            const dayButton = page.getByRole('button', { name: 'Day', exact: true });
            await expect(dayButton).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
            const card = cardFor(page, s.title);
            await expect(card).toBeVisible({ timeout: 15_000 });

            await openEventAndGoBack(page, card, s);

            await expect(dayButton, 'Back returns to the Day view').toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
            expect(viewParam(page), 'Back URL keeps ?view=day').toBe('day');
            expect(dateParam(page), 'Back URL keeps the Day view date').toBe(s.date);
            await expect(cardFor(page, s.title)).toBeVisible({ timeout: 15_000 });
        } finally {
            for (const id of ids) await apiDelete(token, `/events/${id}`);
        }
    });
});
