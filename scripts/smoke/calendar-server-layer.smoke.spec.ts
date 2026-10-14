/**
 * ROK-1774 — the Pelican server-schedule layer on the Week/Day calendar grid.
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
import type { Locator, Page, TestInfo } from '@playwright/test';
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
interface Slot { start: string; end: string; date: string }
interface ListedEvent { id: number; startTime: string; endTime: string }

const overlaps = (s: Slot, e: ListedEvent): boolean =>
    Date.parse(e.startTime) < Date.parse(s.end) && Date.parse(s.start) < Date.parse(e.endTime);

/** Every event that could overlap [from, to): starts in [from - 2d, to), all pages. */
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
 * overlaps (an overlapping card stacks over ours at phone width). Each project
 * starts from a different slot; a sibling that lands in the same slot anyway is
 * caught by the re-read, and the event moves on. Fails loudly if none is free.
 */
async function createInFreeSlot(
    token: string, page: Page, windows: LayerWindow[], title: string, project: string,
): Promise<{ id: number; slot: Slot }> {
    const offset = Math.max(0, ['desktop', 'mobile', 'tablet'].indexOf(project)) * 3;
    for (const w of windows) {
        const all = await slotsInside(page, w);
        const slots = [...all.slice(offset % (all.length || 1)), ...all.slice(0, offset % (all.length || 1))];
        const busy = await eventsNear(token, Date.parse(w.start), Date.parse(w.end));
        for (const slot of slots) {
            if (busy.some((e) => overlaps(slot, e))) continue;
            const created = (await apiPost(token, '/events', {
                title, startTime: slot.start, endTime: slot.end, maxAttendees: 10, gameId: seed?.gameId,
            })) as { id?: number };
            if (typeof created.id !== 'number') throw new Error(`POST /events: ${JSON.stringify(created)}`);
            const rivals = (await eventsNear(token, Date.parse(slot.start), Date.parse(slot.end)))
                .filter((e) => e.id !== created.id && overlaps(slot, e));
            if (rivals.length === 0) return { id: created.id, slot };
            await apiDelete(token, `/events/${created.id}`);
            busy.push(...rivals);
        }
    }
    throw new Error(`no 30-min slot free of other events inside any of ${windows.length} future windows`);
}

/** A viewport point where `card` is the topmost hit, or what covers it instead. */
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
                if (hit && el.contains(hit)) return { x, y };
                if (!first) first = hit ? `${hit.tagName.toLowerCase()}[class="${String(hit.getAttribute('class') ?? '').slice(0, 80)}"]` : 'nothing';
            }
        }
        return { covered: first };
    });
}

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
            const points: Array<{ x: number; y: number }> = [];
            await expect.poll(async () => {
                const hit = await topmostPointOn(card);
                if ('covered' in hit) return `covered by ${hit.covered}`;
                points.push(hit);
                return 'topmost';
            }, { message: 'a visible point of our card is topmost (no band, nav or other event over it)', timeout: 15_000 })
                .toBe('topmost');
            const point = points.at(-1);
            if (!point) throw new Error('topmost poll passed without a point');
            await page.mouse.click(point.x, point.y);
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
});
