/**
 * ROK-1774 — the Pelican server-schedule layer on the Week/Day calendar grid.
 * ROK-1775 — the Month glyph (desktop/tablet), the Schedule rows (phone) and the
 * Filters "Server schedules" toggle (per-run member: it saves a preference).
 *
 * Seed: `POST /admin/test/pelican/seed-servers` (DEMO_MODE) activates Pelican and
 * maps "Demo Server — Running" to a game with daily schedules: start 18:00,
 * stop 02:00, restart 04:00 (+5 min), in the server's zone. The band and ticks
 * therefore exist on EVERY day, so the spec never needs a fixed date for them.
 *
 * ## Determinism
 * - Times: the server zone and the browser zone are both whatever the env runs
 *   in, so nothing here hard-codes an hour. The click-through event is placed
 *   inside a window READ BACK from `GET /game-servers/calendar`, and its day is
 *   computed in the BROWSER in the app's timezone (`raid_ledger_timezone`, else
 *   the browser's) — the same rule the grid zones events with.
 * - Concurrency: desktop, mobile and tablet share ONE API. The seed wipes and
 *   re-inserts `pelican_servers` in one transaction (see `ensureSeeded`), and
 *   every assertion reads names, never row ids. Pelican is never switched off
 *   globally: the gating test removes `pelican` from THIS page's
 *   `/system/status` (the only source of the web plugin store's
 *   `activeSlugs`), so a sibling worker is never pulled out from under. The
 *   real switch-off is a step in the fleet test plan instead.
 * - Views: phones (mobile project) drive Day via the view switcher; desktop and
 *   tablet click the toolbar's Week button (the page forces Month on mount, as
 *   `calendar.smoke.spec.ts` notes).
 * - No global teardown: the projects run concurrently against ONE API with ONE
 *   shared admin, so no project may flip a global toggle or write the admin's
 *   preferences (a last-one-out restore raced a joining worker, Codex P2). The
 *   saved-filter test runs as a FRESH per-run member instead.
 */
import type { Locator, Page, Response, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPatch, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { isDesktop, isMobile } from './helpers';

const RUNNING = 'Demo Server — Running';
const HIDDEN = 'Demo Server — Hidden';
const OFFLINE = 'Demo Server — Offline';
const BAND = '.rbc-background-event.rl-layer-window';
const DAY_MS = 86_400_000;

interface LayerWindow { kind: 'window'; serverName: string; start: string; end: string }
interface SeedResult { gameId: number; gameName: string }

let seed: SeedResult | null = null;

/** The running server's windows over [now - 1d, now + 6d]. */
async function runningWindows(token: string): Promise<LayerWindow[]> {
    const from = new Date(Date.now() - DAY_MS).toISOString();
    const to = new Date(Date.now() + 6 * DAY_MS).toISOString();
    const body = (await apiGet(token, `/game-servers/calendar?from=${from}&to=${to}`)) as
        { data?: Array<{ kind: string; serverName?: string; start?: string; end?: string }> } | null;
    return (body?.data ?? []).filter(
        (i): i is LayerWindow => i.kind === 'window' && i.serverName === RUNNING && !!i.start && !!i.end,
    );
}

/**
 * Seed (idempotent; one transaction, so readers never see an empty table). A
 * sibling worker seeding at the same instant can win the `panel_uuid` unique
 * race; the loser then checks the winner's windows exist and carries on.
 */
async function ensureSeeded(token: string): Promise<SeedResult | null> {
    const res = (await apiPost(token, '/admin/test/pelican/seed-servers')) as Partial<SeedResult>;
    if (typeof res.gameId === 'number' && typeof res.gameName === 'string') {
        return { gameId: res.gameId, gameName: res.gameName };
    }
    const windows = await runningWindows(token);
    expect(windows.length, `seed-servers failed (${JSON.stringify(res)}) and no sibling seed exists`).toBeGreaterThan(0);
    return null;
}

/** `iso` as a yyyy-MM-dd date in the app's timezone, measured in the browser. */
async function appDate(page: Page, iso: string): Promise<string> {
    return page.evaluate((at) => {
        const pref = localStorage.getItem('raid_ledger_timezone');
        const timeZone = pref && pref !== 'auto' ? pref : undefined;
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
            .format(new Date(at));
    }, iso);
}

/** Open the grid on `date` in Week (desktop/tablet) or Day (phone) view. */
async function openGrid(page: Page, testInfo: TestInfo, date?: string): Promise<void> {
    await page.goto(date ? `/calendar?date=${date}` : '/calendar');
    if (isMobile(testInfo)) {
        const switcher = page.locator('[aria-label="Calendar view switcher"]');
        await switcher.getByRole('button', { name: 'Day' }).click({ timeout: 15_000 });
    } else {
        await page.getByRole('button', { name: 'Week', exact: true }).click({ timeout: 15_000 });
    }
    await expect(page.locator('.rbc-time-view')).toBeVisible({ timeout: 15_000 });
}

/** The first restart glyph of the running server. */
function restartGlyph(page: Page): Locator {
    return page.getByRole('button', { name: new RegExp(`^Restart · ${RUNNING} · `) });
}

/** Count `/game-servers/*` requests the page makes from now on. */
function countLayerRequests(page: Page): { calendar: () => number; any: () => number } {
    const urls: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/game-servers/')) urls.push(r.url()); });
    return {
        calendar: () => urls.filter((u) => u.includes('/game-servers/calendar')).length,
        any: () => urls.length,
    };
}

/** The Filters entry, opened: the toolbar funnel's panel ≥1024px, else the FAB's sheet. */
async function openFilters(page: Page, testInfo: TestInfo): Promise<Locator> {
    if (isDesktop(testInfo)) {
        await page.getByTestId('filter-panel-trigger').click({ timeout: 15_000 });
        return page.getByTestId('filter-panel');
    }
    await page.getByTestId('filter-fab').click({ timeout: 15_000 });
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    return sheet;
}

/** `token`'s saved calendar filter back to "every game" (an empty list resolves to all). */
async function resetSavedGameFilter(token: string): Promise<void> {
    await apiPatch(token, '/users/me/preferences', { preferences: { calendarGameFilter: [] } });
}

/** A fresh member for THIS run only (quiet DMs); the caller deletes it. */
async function seedMember(token: string): Promise<number> {
    const user = (await apiPost(token, '/admin/test/seed-non-guild-user', { quietDms: true })) as { userId?: number };
    if (typeof user.userId !== 'number') throw new Error(`seed-non-guild-user: ${JSON.stringify(user)}`);
    return user.userId;
}

const SLOT_MS = 30 * 60_000;
/**
 * Clearance around our card. A card is never shorter than `.day-event-block`'s
 * `min-height: 100px` (calendar-styles.css), and an hour of grid is as little as
 * 44px (phone Day view, `.calendar-view-day .rbc-timeslot-group`) or 40px (Week
 * view). react-big-calendar lays cards out by TIME, not by that min-height, so a
 * 1h card ending at 21:00 still paints ~100px — over a 21:00 card (main CI,
 * mobile: "Alt Raid Night … intercepts pointer events"). 100px / 40px-per-hour
 * = 2.5h, so no other event may START within 2.5h either side of ours.
 */
const CLEARANCE_MS = 150 * 60_000;
/**
 * Look-back for EARLIER events on the phone's Day view. There a card is not
 * time-sized at all: `.calendar-view-day .rbc-time-view .rbc-event` is
 * `height: auto !important` (calendar-styles.css), so a card is as tall as its
 * content (title, game, avatars, role/Join actions — the roster lands async)
 * and hangs down past its own end time. Main CI 16:08Z, mobile: a 6–9 PM
 * "Mythic+ Push Night" card, 3.5h (154px) above ours, intercepted the click on
 * a 9:30 PM card. Cards grow DOWNWARD only, so only earlier events need this:
 * none may still be running at any point in the 8h before our start. 8h of
 * phone Day grid is 352px (44px/h), several Day cards tall. The superset test
 * on the END also covers a card carried over from the day before, which
 * renders from 00:00 of our day.
 */
const DAY_VIEW_LOOKBACK_MS = 8 * 60 * 60_000;
interface Slot { start: string; end: string; date: string }
interface ListedEvent { id: number; startTime: string; endTime: string }
/** How far back an EARLIER event must have started / ended so its card cannot reach ours. */
interface Reach { start: number; end: number }

/** Week view (desktop/tablet) paints max(duration, 100px); the phone's Day view paints content-tall cards. */
const reachFor = (project: string): Reach => (project === 'mobile'
    ? { start: DAY_VIEW_LOOKBACK_MS, end: DAY_VIEW_LOOKBACK_MS }
    : { start: CLEARANCE_MS, end: 0 });

/** `e` overlaps our slot, starts within CLEARANCE_MS after it, or is an earlier card that can paint down over ours. */
const crowds = (s: Slot, e: ListedEvent, reach: Reach): boolean => {
    const start = Date.parse(s.start);
    const eStart = Date.parse(e.startTime);
    if (eStart >= start) return eStart < Date.parse(s.end) || eStart - start < CLEARANCE_MS;
    return Date.parse(e.endTime) > start - reach.end || start - eStart < reach.start;
};

/** Every event that could crowd [from, to): starts in [from - 2d, to], all pages. */
async function eventsNear(token: string, from: number, to: number): Promise<ListedEvent[]> {
    const out: ListedEvent[] = [];
    const range = `startAfter=${new Date(from - 2 * DAY_MS).toISOString()}&endBefore=${new Date(to).toISOString()}`;
    for (let page = 1; page <= 20; page++) {
        const body = (await apiGet(token, `/events?${range}&limit=100&page=${page}`)) as
            { data?: ListedEvent[]; meta?: { hasMore?: boolean } } | null;
        if (!body?.data) throw new Error(`GET /events?${range} failed`);
        out.push(...body.data);
        if (!body.meta?.hasMore) return out;
    }
    throw new Error(`GET /events?${range}: more than 20 pages`);
}

/** 30-min slots inside `w` (≥30 min clear of start, ≥60 min of end), each on ONE app-tz day. */
async function slotsInside(page: Page, w: LayerWindow): Promise<Slot[]> {
    const slots: Slot[] = [];
    for (let t = Date.parse(w.start) + SLOT_MS; t + 3 * SLOT_MS <= Date.parse(w.end); t += SLOT_MS) {
        const start = new Date(t).toISOString();
        const end = new Date(t + SLOT_MS).toISOString();
        const date = await appDate(page, start);
        if (date === (await appDate(page, end))) slots.push({ start, end, date });
    }
    return slots;
}

/**
 * Create `title` in a 30-min slot inside a future window that NO other event
 * crowds (see `CLEARANCE_MS` / `DAY_VIEW_LOOKBACK_MS`: a nearby or earlier card
 * paints over ours at phone width).
 * Each project starts from a different window (day). A sibling's event created
 * between our check and our create is caught by the re-read: the NEWER event
 * (higher id) yields and moves on, so two siblings never both back off. Fails
 * loudly if no slot is free.
 */
async function createInFreeSlot(
    token: string, page: Page, windows: LayerWindow[], title: string, project: string,
): Promise<{ id: number; slot: Slot }> {
    const offset = Math.max(0, ['desktop', 'mobile', 'tablet'].indexOf(project)) % (windows.length || 1);
    const reach = reachFor(project);
    const back = Math.max(reach.start, reach.end);
    for (const w of [...windows.slice(offset), ...windows.slice(0, offset)]) {
        const near = (s: Slot) => eventsNear(token, Date.parse(s.start) - back, Date.parse(s.end) + CLEARANCE_MS);
        const busy = await eventsNear(token, Date.parse(w.start) - back, Date.parse(w.end) + CLEARANCE_MS);
        for (const slot of await slotsInside(page, w)) {
            if (busy.some((e) => crowds(slot, e, reach))) continue;
            const created = (await apiPost(token, '/events', {
                title, startTime: slot.start, endTime: slot.end, maxAttendees: 10, gameId: seed?.gameId,
            })) as { id?: number };
            if (typeof created.id !== 'number') throw new Error(`POST /events: ${JSON.stringify(created)}`);
            const createdId = created.id;
            const rivals = (await near(slot)).filter((e) => e.id < createdId && crowds(slot, e, reach));
            if (rivals.length === 0) return { id: createdId, slot };
            await apiDelete(token, `/events/${createdId}`);
            busy.push(...rivals);
        }
    }
    throw new Error(`no 30-min slot clear of other events (${CLEARANCE_MS / 60_000} min after, ${back / 60_000} min before) in any of ${windows.length} future windows`);
}

/** A point (relative to `card`) where the card is the topmost hit, or what covers it instead. */
type CardHit = { x: number; y: number } | { covered: string };

/**
 * Re-centre `card`, clamp its box to the viewport, and hit-test its visible part
 * centre-first on a 3-column grid (every 3px). Hit-testing skips the bands
 * (`pointer-events:none`), so a hit on the card means nothing intercepts a click
 * there. A raw centre is not enough on a phone: the sticky header / mobile nav
 * (hide-on-scroll, animated `top`), the fixed tab bar and FAB, or a box that
 * runs past the clipped viewport edge can own the exact centre while the rest
 * of the card stays clickable. Re-centring on every poll absorbs late layout
 * shifts (layer data landing after the scroll).
 *
 * The point is returned RELATIVE to the card, never as viewport coordinates:
 * the re-centring scroll flips the phone's hide-on-scroll header, whose animated
 * `top` (300ms) moves the sticky chrome AFTER this measures, so a raw
 * `page.mouse.click(x, y)` landed on a stale point and never opened the event
 * (main CI, mobile only). A hit on the card's own quick actions (Join / Leave /
 * a link) is skipped too: those stop propagation and by design don't navigate.
 */
async function topmostPointOn(card: Locator): Promise<CardHit> {
    return card.evaluate((el): CardHit => {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        const top = Math.max(r.top, 0);
        const bottom = Math.min(r.bottom, window.innerHeight);
        const left = Math.max(r.left, 0);
        const right = Math.min(r.right, window.innerWidth);
        if (bottom - top < 2 || right - left < 2) return { covered: `off-screen at ${Math.round(r.x)},${Math.round(r.y)}` };
        const cy = (top + bottom) / 2;
        const xs = [0.5, 0.25, 0.75].map((f) => left + (right - left) * f);
        const ys = [cy];
        for (let dy = 3; dy < (bottom - top) / 2; dy += 3) ys.push(cy - dy, cy + dy);
        let first = '';
        for (const y of ys) {
            for (const x of xs) {
                const hit = document.elementFromPoint(x, y);
                const action = hit?.closest('button, a');
                if (hit && el.contains(hit) && !(action && el.contains(action))) return { x: x - r.left, y: y - r.top };
                if (!first) first = hit ? `${hit.tagName.toLowerCase()}[class="${String(hit.getAttribute('class') ?? '').slice(0, 80)}"]` : 'nothing';
            }
        }
        return { covered: first };
    });
}

/** ROK-1775 — the Filters "Server schedules" checkbox (Layers group). */
const LAYER_TOGGLE = { name: 'Server schedules' } as const;

/** True for the preferences PATCH that carries `calendarHiddenLayers`. */
function isHiddenLayersSave(r: Response): boolean {
    if (r.request().method() !== 'PATCH' || !r.url().includes('/users/me/preferences')) return false;
    const body = r.request().postDataJSON() as { preferences?: Record<string, unknown> } | null;
    return body?.preferences !== undefined && 'calendarHiddenLayers' in body.preferences;
}

/**
 * Click the layer checkbox and wait until THIS preference write has landed.
 * Writes are debounced (800 ms) and batched, and the page's own mount writes the
 * forced Month view (`calendarView`) on desktop — a bare "any preferences PATCH"
 * wait can resolve on that one and reload before the layer write is ever sent.
 */
async function setLayerShown(page: Page, filters: Locator, shown: boolean): Promise<void> {
    const box = filters.getByRole('checkbox', LAYER_TOGGLE);
    await expect(box).toBeChecked({ checked: !shown, timeout: 15_000 });
    const saved = page.waitForResponse(isHiddenLayersSave);
    await box.click();
    expect((await saved).ok(), 'calendarHiddenLayers preference saved').toBe(true);
    await expect(box).toBeChecked({ checked: shown });
}

/** The layer's per-view marker: Month glyphs (desktop/tablet) or Schedule rows (phone). */
function viewMarkers(page: Page, testInfo: TestInfo): Locator {
    return page.getByTestId(isMobile(testInfo) ? 'schedule-layer-row' : 'layer-month-glyph');
}

/** One Month/Schedule day entry (row or tooltip line) of the running server. */
const RUNNING_ENTRY = new RegExp(`^(Server up|Restart) · ${RUNNING} · `);

test.describe.serial('Calendar — server-schedule layer (ROK-1774)', () => {
    // The seed activates Pelican (idempotent) and is NEVER undone: deactivating a
    // shared plugin mid-run is what raced the sibling projects. A Pelican layer
    // left active with seeded servers is harmless to other specs, because its
    // bands are `pointer-events:none`. Fleet/CI envs are disposable.
    // The admin-context tests need "all games" saved. `[]` is the default and the
    // same value calendar.smoke.spec.ts writes, so this write cannot race a
    // sibling project into hiding anything.
    test.beforeAll(async () => {
        const token = await getAdminToken();
        await apiPatch(token, '/users/me/preferences', { preferences: { calendarGameFilter: [] } });
        seed = await ensureSeeded(token);
    });

    test('band with its label renders on the grid; hidden/unmapped servers never do', async ({ page }, testInfo) => {
        await openGrid(page, testInfo);
        const band = page.locator(BAND).filter({ hasText: `Server up · ${RUNNING}` }).first();
        await expect(band).toBeAttached({ timeout: 15_000 });
        await expect(band.getByTestId('layer-window-label').first()).toContainText(`Server up · ${RUNNING}`);
        await expect(page.locator(BAND).filter({ hasText: HIDDEN })).toHaveCount(0);
        await expect(page.locator(BAND).filter({ hasText: OFFLINE })).toHaveCount(0);
    });

    test('tick + glyph render; opening the glyph shows server, effect, time and live state', async ({ page }, testInfo) => {
        await openGrid(page, testInfo);
        await expect(page.getByTestId('layer-marker-tick').first()).toBeAttached({ timeout: 15_000 });
        // The LAST restart glyph sits in the right-most column on Week (AC8's flip case).
        const glyph = restartGlyph(page).last();
        await glyph.click();
        const tip = glyph.locator('xpath=..').getByRole('tooltip');
        await expect(tip).toBeVisible();
        await expect(tip).toContainText(new RegExp(`^Restart · ${RUNNING} · \\d{1,2}:\\d{2} [AP]M`));
        await expect(tip).toContainText(/Online · checked (just now|\d+ min ago)/);
        const box = await tip.boundingBox();
        const viewport = page.viewportSize();
        expect(box, 'tooltip has a layout box').not.toBeNull();
        expect(box?.x ?? -1, 'tooltip starts inside the viewport').toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0), 'tooltip ends inside the viewport (AC8)').toBeLessThanOrEqual(viewport?.width ?? 0);
    });

    test('clicking an event under a band still opens the event', async ({ page, world }, testInfo) => {
        const token = await getAdminToken();
        const now = Date.now();
        const windows = (await runningWindows(token)).filter((w) => Date.parse(w.start) > now + 5 * 60_000);
        expect(windows.length, 'a future window of the running server').toBeGreaterThan(0);
        await page.goto('/calendar');
        const title = world.uid('rok-1774-under-band');
        const { id, slot } = await createInFreeSlot(token, page, windows, title, testInfo.project.name);
        try {
            await openGrid(page, testInfo, slot.date);
            await expect(page.locator(BAND).first()).toBeAttached({ timeout: 15_000 });
            const card = page.locator('.rbc-event').filter({ hasText: title }).first();
            await expect(card).toBeVisible({ timeout: 15_000 });
            // A real click on a point of the card that nothing (band, nav, tab bar,
            // other event) covers — the poll names the occluder if there is none.
            // The locator click re-checks that point at click time: it waits for the
            // card to be stable and fails with "<x> intercepts pointer events" if a
            // band (or anything else) owns it, so the band is still proven harmless.
            const points: Array<{ x: number; y: number }> = [];
            await expect.poll(async () => {
                const hit = await topmostPointOn(card);
                if ('covered' in hit) return `covered by ${hit.covered}`;
                points.push(hit);
                return 'topmost';
            }, { message: 'a visible point of our card is topmost (no band, nav or other event over it)', timeout: 15_000 })
                .toBe('topmost');
            const position = points.at(-1);
            if (!position) throw new Error('topmost poll passed without a point');
            await card.click({ position });
            await expect(page).toHaveURL(new RegExp(`/events/${id}(\\?|$)`));
        } finally {
            await apiDelete(token, `/events/${id}`);
        }
    });

    test('Filters "None" hides every band with no new calendar request', async ({ page }, testInfo) => {
        // "None" SAVES the filter, so this runs as a fresh member: the shared
        // admin's preference is never written by any project.
        const admin = await getAdminToken();
        const memberId = await seedMember(admin);
        try {
            const memberJwt = await signInOnboardedMember(page, memberId);
            await openGrid(page, testInfo);
            await expect(page.locator(BAND).first()).toBeAttached({ timeout: 15_000 });
            const requests = countLayerRequests(page);
            const filters = await openFilters(page, testInfo);
            await filters.getByRole('button', { name: 'None' }).click();
            await expect(filters.getByText(/^0 of \d+ selected$/)).toBeVisible();
            await expect(page.locator(BAND)).toHaveCount(0);
            await expect(page.getByTestId('layer-marker-glyph')).toHaveCount(0);
            expect(requests.calendar(), 'the game filter is client-side (no refetch)').toBe(0);
            await resetSavedGameFilter(memberJwt);
            await openGrid(page, testInfo);
            await expect(page.locator(BAND).first()).toBeAttached({ timeout: 15_000 });
        } finally {
            await apiDelete(admin, `/users/${memberId}`).catch(() => undefined);
        }
    });

    test('with Pelican inactive no band or tick renders and no layer request fires', async ({ page }, testInfo) => {
        await page.route('**/system/status', async (route) => {
            const res = await route.fetch();
            const body = (await res.json()) as { activePlugins?: string[] };
            const activePlugins = (body.activePlugins ?? []).filter((s) => s !== 'pelican');
            await route.fulfill({ response: res, json: { ...body, activePlugins } });
        });
        const requests = countLayerRequests(page);
        const status = page.waitForResponse((r) => r.url().includes('/system/status'));
        const events = page.waitForResponse((r) => /\/events(\?|$)/.test(r.url()));
        await openGrid(page, testInfo);
        // Both responses landed and the grid is up: an ungated layer would have
        // asked for /game-servers/calendar on mount, before either of them.
        await Promise.all([status, events]);
        await expect(page.locator(BAND)).toHaveCount(0);
        await expect(page.getByTestId('layer-marker-tick')).toHaveCount(0);
        expect(requests.any(), 'an inactive plugin layer fires no /game-servers request').toBe(0);
    });

    test('Month: a seeded day shows one glyph; opening it lists the day\'s items (ROK-1775)', async ({ page }, testInfo) => {
        test.skip(isMobile(testInfo), 'Phones open on Schedule; the Month glyph is covered on desktop + tablet');
        await page.goto('/calendar'); // ≥768px opens on Month
        await expect(page.locator('.rbc-month-view')).toBeVisible({ timeout: 15_000 });
        // A day whose (hidden, pre-rendered) tooltip carries a restart of the running server.
        const day = page.getByTestId('layer-month-day')
            .filter({ has: page.getByTestId('layer-tip-entry').filter({ hasText: `Restart · ${RUNNING} · ` }) }).first();
        await expect(day).toBeVisible({ timeout: 15_000 });
        await expect(day.getByTestId('layer-month-glyph'), 'one glyph per month cell').toHaveCount(1);
        await expect(page.locator(BAND), 'Month draws no bands').toHaveCount(0);
        const glyph = day.getByTestId('layer-month-glyph');
        await glyph.click();
        await expect(glyph).toHaveAttribute('aria-expanded', 'true');
        const tip = day.getByRole('tooltip');
        await expect(tip).toBeVisible();
        const entries = tip.getByTestId('layer-tip-entry');
        await expect(entries.filter({ hasText: `Restart · ${RUNNING} · ` })).toHaveCount(1);
        await expect(entries.filter({ hasText: `Server up · ${RUNNING} · ` }).first()).toBeVisible();
        await expect(entries.filter({ hasText: HIDDEN })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(glyph).toHaveAttribute('aria-expanded', 'false');
    });

    test('Schedule: a muted server row sits between the day\'s events by time (ROK-1775)', async ({ page, world }, testInfo) => {
        test.skip(!isMobile(testInfo), 'The Schedule list is the phone view');
        const token = await getAdminToken();
        const now = Date.now();
        const windows = (await runningWindows(token)).filter((w) => Date.parse(w.start) > now + 5 * 60_000);
        expect(windows.length, 'a future window of the running server').toBeGreaterThan(0);
        await page.goto('/calendar');
        const title = world.uid('rok-1775-schedule-row');
        const { id, slot } = await createInFreeSlot(token, page, windows, title, testInfo.project.name);
        try {
            await page.goto('/calendar'); // phones open on Schedule
            const day = page.locator(`[data-testid="schedule-day"][data-date="${slot.date}"]`);
            await expect(day.getByRole('button').filter({ hasText: title })).toBeVisible({ timeout: 15_000 });
            await expect(day.getByTestId('schedule-layer-row').filter({ hasText: RUNNING_ENTRY }).first()).toBeAttached({ timeout: 15_000 });
            // DOM order = time order. Our event sits INSIDE a running window, so that
            // window's "Server up" row (its start, or 00:00 when carried over) precedes it.
            const order = await day.evaluate((el, t) => [...el.querySelectorAll('[data-testid="schedule-layer-row"], button')]
                .map((n) => (n.getAttribute('data-testid') === 'schedule-layer-row' ? `row:${n.textContent ?? ''}` : (n.textContent ?? '').includes(t) ? 'event' : 'other')), title);
            const eventAt = order.indexOf('event');
            const upBefore = order.slice(0, Math.max(eventAt, 0)).some((o) => o.startsWith(`row:Server up · ${RUNNING} · `));
            expect({ eventAt, upBefore, order }, 'the window row comes before the event inside it').toMatchObject({ upBefore: true });
            expect(eventAt, 'the event card is listed after a server row').toBeGreaterThan(0);
            const row = day.getByTestId('schedule-layer-row').first();
            await expect(row, 'server rows are muted (text-dim, no card chrome)').toHaveClass(/\btext-dim\b/);
            await expect(row).not.toHaveClass(/\bborder\b|\bbg-surface\b/);
        } finally {
            await apiDelete(token, `/events/${id}`);
        }
    });

    test('"Server schedules" OFF hides glyphs, rows and bands, survives reload, then back ON (ROK-1775)', async ({ page }, testInfo) => {
        // The toggle SAVES a preference, so this runs as a fresh per-run member.
        const admin = await getAdminToken();
        const memberId = await seedMember(admin);
        try {
            await signInOnboardedMember(page, memberId);
            await page.goto('/calendar');
            await expect(viewMarkers(page, testInfo).first()).toBeAttached({ timeout: 15_000 });
            await setLayerShown(page, await openFilters(page, testInfo), false);
            await expect(viewMarkers(page, testInfo)).toHaveCount(0);

            const events = page.waitForResponse((r) => /\/events(\?|$)/.test(r.url()));
            await page.reload();
            await events;
            // Unchecked after reload = the saved preference was read back.
            const reopened = await openFilters(page, testInfo);
            await expect(reopened.getByRole('checkbox', LAYER_TOGGLE)).not.toBeChecked({ timeout: 15_000 });
            await expect(viewMarkers(page, testInfo)).toHaveCount(0);
            await page.keyboard.press('Escape');

            // The grid (Week/Day): no band while OFF; turning it back ON brings the
            // band in this same view, which proves the 0 above was not just "not loaded yet".
            await openGrid(page, testInfo);
            await expect(page.locator(BAND)).toHaveCount(0);
            await expect(page.getByTestId('layer-marker-glyph')).toHaveCount(0);
            await setLayerShown(page, await openFilters(page, testInfo), true);
            await expect(page.locator(BAND).first()).toBeAttached({ timeout: 15_000 });
        } finally {
            await apiDelete(admin, `/users/${memberId}`).catch(() => undefined);
        }
    });
});
