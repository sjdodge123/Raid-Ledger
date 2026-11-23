/**
 * ROK-2299 — Day-view cards on the PHONE keep their time-sized height and clip
 * their content, so an earlier, longer card never hangs over a later one and
 * takes its taps. Desktop/tablet (>= 769px) Day view is unchanged: a card is
 * content-tall (min-height 100px) and shows all of its content.
 *
 * Seed: two events created through `POST /events` (no game, so nothing IGDB can
 * rename): a 90-minute "long" event with a description, and a 30-minute "short"
 * event that starts the moment the long one ends. Under the old phone CSS
 * (`height: auto !important; min-height: 100px`) the long card was >= 100px tall
 * against a 66px time slot (44px per hour), so it overhung the short card.
 *
 * ## Determinism
 * - Each project uses its own far-future UTC day (90 + 7 * index days ahead), so
 *   the concurrent projects and the near-term demo data never share the grid.
 * - The hour is picked so both events fall on ONE app-timezone day, computed in
 *   the BROWSER (`raid_ledger_timezone`, else the browser zone) — the rule the
 *   grid zones events with. Nothing hard-codes a local hour.
 * - Ids are claimed straight after each create; `finally` deletes them, and the
 *   `world` prefix cleanup backs that up.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { isMobile } from './helpers';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LONG_MS = 90 * 60_000;
const SHORT_MS = 30 * 60_000;
const DESCRIPTION = 'ROK-2299: the desktop Day view shows the whole card, this line included.';

interface Seeded { longId: number; shortId: number; longTitle: string; shortTitle: string; date: string }

/** The app-timezone calendar day (yyyy-mm-dd) of `iso`. */
async function appDate(page: Page, iso: string): Promise<string> {
    return page.evaluate((at) => {
        const pref = localStorage.getItem('raid_ledger_timezone');
        const timeZone = pref && pref !== 'auto' ? pref : undefined;
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
            .format(new Date(at));
    }, iso);
}

/** A start instant whose long + short events both land on one app-tz day. */
async function pickStart(page: Page, testInfo: TestInfo): Promise<{ start: number; date: string }> {
    const idx = Math.max(0, ['desktop', 'mobile', 'tablet'].indexOf(testInfo.project.name));
    const day = Math.floor(Date.now() / DAY_MS) * DAY_MS + (90 + 7 * idx) * DAY_MS;
    for (let h = 2; h <= 20; h++) {
        const start = day + h * HOUR_MS;
        const date = await appDate(page, new Date(start).toISOString());
        if (date === (await appDate(page, new Date(start + LONG_MS + SHORT_MS).toISOString()))) return { start, date };
    }
    throw new Error('no start hour keeps both events on one app-timezone day');
}

async function createEvent(token: string, body: Record<string, unknown>): Promise<number> {
    const created = (await apiPost(token, '/events', { maxAttendees: 10, ...body })) as { id?: number } | null;
    if (typeof created?.id !== 'number') throw new Error(`POST /events: ${JSON.stringify(created)}`);
    return created.id;
}

/** Seed the long + back-to-back short event; every created id is pushed to `ids` at once. */
async function seedPair(token: string, page: Page, testInfo: TestInfo, uid: (s: string) => string, ids: number[]): Promise<Seeded> {
    const { start, date } = await pickStart(page, testInfo);
    const iso = (t: number) => new Date(t).toISOString();
    const longTitle = uid('rok-2299-long');
    const shortTitle = uid('rok-2299-short');
    const longId = await createEvent(token, { title: longTitle, description: DESCRIPTION, startTime: iso(start), endTime: iso(start + LONG_MS) });
    ids.push(longId);
    const shortId = await createEvent(token, { title: shortTitle, startTime: iso(start + LONG_MS), endTime: iso(start + LONG_MS + SHORT_MS) });
    ids.push(shortId);
    return { longId, shortId, longTitle, shortTitle, date };
}

/** Open Day view on `date`: phones via the view switcher, wider viewports via `?view=day`. */
async function openDay(page: Page, testInfo: TestInfo, date: string): Promise<void> {
    if (isMobile(testInfo)) {
        await page.goto(`/calendar?date=${date}`);
        // Phones open in Schedule (no `?view=` deep link below 768px), and a Day click
        // during the page's mount-time URL writes can be lost — click until it sticks.
        const switcher = page.locator('[aria-label="Calendar view switcher"]');
        await expect(async () => {
            await switcher.getByRole('button', { name: 'Day' }).click({ timeout: 5_000 });
            await expect(page.locator('.rbc-time-view')).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 25_000 });
    } else {
        await page.goto(`/calendar?view=day&date=${date}`);
        await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.locator('.rbc-time-view')).toBeVisible({ timeout: 15_000 });
}

const cardFor = (page: Page, title: string): Locator => page.locator('.rbc-event').filter({ hasText: title }).first();

/** Centre `card` and return a point (relative to it) where it is the topmost hit, or what covers it. */
async function topmostPointOn(card: Locator): Promise<{ x: number; y: number } | { covered: string }> {
    return card.evaluate((el) => {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        const xs = [0.5, 0.25, 0.75].map((f) => r.left + r.width * f);
        const y = r.top + r.height / 2;
        let first = '';
        for (const x of xs) {
            const hit = document.elementFromPoint(x, y);
            const action = hit?.closest('button, a');
            if (hit && el.contains(hit) && !(action && el.contains(action))) return { x: x - r.left, y: y - r.top };
            if (!first) first = hit ? `${hit.tagName.toLowerCase()}[class="${String(hit.getAttribute('class') ?? '').slice(0, 80)}"]` : 'nothing';
        }
        return { covered: first };
    });
}

test.describe('Calendar — Day-view cards never overlap a later event (ROK-2299)', () => {
    test('phone: a long card stays in its slot and the later card opens its own event', async ({ page, world }, testInfo) => {
        test.skip(!isMobile(testInfo), 'phone layout only (max-width: 768px); wider viewports are the desktop test');
        const token = await getAdminToken();
        const ids: number[] = [];
        await page.goto('/calendar');
        try {
            const s = await seedPair(token, page, testInfo, (p) => world.uid(p), ids);
            await openDay(page, testInfo, s.date);
            const longCard = cardFor(page, s.longTitle);
            const shortCard = cardFor(page, s.shortTitle);
            await expect(longCard).toBeVisible({ timeout: 15_000 });
            await expect(shortCard).toBeVisible({ timeout: 15_000 });

            await expect.poll(async () => {
                const a = await longCard.boundingBox();
                const b = await shortCard.boundingBox();
                return a && b ? Math.round(a.y + a.height - b.y) : Number.POSITIVE_INFINITY;
            }, { message: 'px the 90-min card reaches past the top of the back-to-back 30-min card (time-sized cards: <= 1)', timeout: 15_000 })
                .toBeLessThanOrEqual(1);

            // A 30-minute card still shows its duration pill and a one-line title.
            const cardBox = await shortCard.boundingBox();
            const pillBox = await shortCard.locator('.day-event-duration').boundingBox();
            const titleBox = await shortCard.locator('.day-event-title').boundingBox();
            if (!cardBox || !pillBox || !titleBox) throw new Error('short card, pill or title has no box');
            expect(pillBox.y, 'duration pill starts inside the 30-min card').toBeLessThan(cardBox.y + cardBox.height);
            expect(titleBox.y, 'title starts inside the 30-min card').toBeLessThan(cardBox.y + cardBox.height);
            expect(titleBox.height, 'title is one line (ellipsised, not wrapped)').toBeLessThan(28);

            const points: Array<{ x: number; y: number }> = [];
            await expect.poll(async () => {
                const hit = await topmostPointOn(shortCard);
                if ('covered' in hit) return `covered by ${hit.covered}`;
                points.push(hit);
                return 'topmost';
            }, { message: 'the 30-min card is the topmost hit (the long card above does not cover it)', timeout: 15_000 })
                .toBe('topmost');
            const position = points.at(-1);
            if (!position) throw new Error('topmost poll passed without a point');
            await shortCard.click({ position });
            await expect(page).toHaveURL(new RegExp(`/events/${s.shortId}(\\?|$)`));
        } finally {
            for (const id of ids) await apiDelete(token, `/events/${id}`);
        }
    });

    test('desktop/tablet: Day view still shows the whole card content', async ({ page, world }, testInfo) => {
        test.skip(isMobile(testInfo), 'the phone layout is the test above');
        const token = await getAdminToken();
        const ids: number[] = [];
        await page.goto('/calendar');
        try {
            const s = await seedPair(token, page, testInfo, (p) => world.uid(p), ids);
            await openDay(page, testInfo, s.date);
            const longCard = cardFor(page, s.longTitle);
            await expect(longCard).toBeVisible({ timeout: 15_000 });
            await expect(longCard.locator('.day-event-description')).toBeVisible();
            // What main (and this branch) does at >= 769px, measured on slot-2 at 1280 and 810:
            // `.rbc-event` gets `height: auto !important; min-height: 100px; overflow: visible`,
            // but react-big-calendar's `.rbc-day-slot .rbc-event-content { flex: 1 1 0 }` keeps
            // the auto height at the 100px minimum, so the `.day-event-block` (which paints the
            // card's gradient) grows past `.rbc-event` (110px vs 100px) and nothing clips it.
            // So "unchanged" = nothing clips: the phone rules (time-sized card, overflow hidden,
            // 2-line clamp) would each fail one of these if they leaked above 768px.
            await expect.poll(async () => longCard.evaluate((el) => {
                const block = el.querySelector('.day-event-block');
                const desc = el.querySelector('.day-event-description');
                const slot = document.querySelector('.rbc-day-slot .rbc-timeslot-group');
                if (!block || !desc || !slot) return 'missing block, description or time slot';
                const hourPx = slot.getBoundingClientRect().height;
                const card = el.getBoundingClientRect();
                const b = block.getBoundingClientRect();
                const d = desc.getBoundingClientRect();
                const problems: string[] = [];
                if (card.height < 99) problems.push(`card ${Math.round(card.height)}px < 100px minimum`);
                if (card.height <= hourPx * 1.5 + 1) problems.push(`card ${Math.round(card.height)}px is time-sized (90 min = ${Math.round(hourPx * 1.5)}px)`);
                if (getComputedStyle(el).overflow !== 'visible') problems.push(`.rbc-event overflow ${getComputedStyle(el).overflow}`);
                if (getComputedStyle(block).overflow !== 'visible') problems.push(`.day-event-block overflow ${getComputedStyle(block).overflow}`);
                if (desc.scrollHeight > desc.clientHeight + 1) problems.push(`description clipped (${desc.scrollHeight} > ${desc.clientHeight})`);
                if (d.bottom > b.bottom + 1) problems.push(`description ends ${Math.round(d.bottom - b.bottom)}px below the painted block`);
                return problems.join('; ') || 'content-tall';
            }), { message: 'desktop/tablet Day card is content-tall and unclipped (phone clip rules must not apply >= 769px)', timeout: 15_000 })
                .toBe('content-tall');
        } finally {
            for (const id of ids) await apiDelete(token, `/events/${id}`);
        }
    });
});
