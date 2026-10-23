/**
 * Hub Overview arrange smoke (ROK-1918 L8) — desktop AND mobile projects.
 *
 * Each test seeds its OWN WoW guild hub through the DEMO_MODE fixture
 * `POST /admin/test/wow/seed-guild` (per-project, per-worker, per-run name —
 * the same seed `guild-page.smoke.spec.ts` uses), so no two tests share a
 * layout. The arranger is the seeded officer: the seed grants them by name, so
 * `viewer.canEdit` is true (spec §1.3 — Arrange follows `canEdit`). The plain
 * member (rank 3) is the read-only viewer. The seed tags a weekly series and a
 * past raid with attendance, so the Events and Attendance cards render.
 *
 * Reorder uses the Move up / Move down buttons on both projects — native drag
 * is desktop-only and not scripted (spec §5). `finally` resets the layout with
 * the admin token (staff are `canEdit` on every hub) and deletes the users, so
 * a rerun or a later spec always sees the default Overview.
 */
import type { Locator, Page, Response, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPatch, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number }>;
}

/** The two cards the reorder swaps, by their `WidgetCard` section ids. */
const MOVED_CARD = 'guild-attendance';
const NEIGHBOUR_CARD = 'members-summary';
const HIDDEN_CARD = 'guild-events';

function guildName(testInfo: TestInfo): string {
    return `Arrange ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo) })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    return { guildId: body.guildId, users: body.users };
}

/** Seed a guild, run `body`, then always reset its layout and delete the seeded users. */
async function withGuild(testInfo: TestInfo, body: (guild: SeededGuild) => Promise<void>): Promise<void> {
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    try {
        await body(guild);
    } finally {
        await apiPatch(token, `/guilds/${guild.guildId}/widget-prefs`, { reset: true }).catch(() => undefined);
        for (const user of Object.values(guild.users)) {
            await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    }
}

async function openOverviewAs(page: Page, guild: SeededGuild, role: Role): Promise<void> {
    await signInOnboardedMember(page, guild.users[role].userId);
    await page.goto(`/hubs/${guild.guildId}`);
    await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
}

/** Register BEFORE the click that sends it. */
function widgetPrefsPatch(page: Page, guildId: number): Promise<Response> {
    return page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith(`/guilds/${guildId}/widget-prefs`),
        { timeout: 15_000 },
    );
}

/** Ids of the arrange rows, in list order (`arrange-row-<widget id>`). */
function rowIds(page: Page): Promise<string[]> {
    return page.locator('ol[aria-label="Overview widgets, in order"] > li')
        .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid') ?? ''));
}

/** The given card ids as they appear in the Overview grid, in DOM order. */
function gridOrder(page: Page, ids: readonly string[]): Promise<string[]> {
    return page.getByTestId('guild-overview').evaluate(
        (el, wanted) => Array.from(el.querySelectorAll('section[id]')).map((s) => s.id).filter((id) => wanted.includes(id)),
        [...ids],
    );
}

async function enterArrange(page: Page): Promise<Locator> {
    const button = page.getByTestId('hub-arrange');
    await expect(button, 'Arrange waits for the raids query, then enables').toBeEnabled({ timeout: 15_000 });
    await button.click();
    const mode = page.getByTestId('hub-arrange-mode');
    await expect(mode).toBeVisible();
    return mode;
}

/**
 * Every row must fit the viewport: below lg an implicit `auto` grid track once sized the list to the longest
 * untruncated title, so on a phone each row's Hide/Show button sat past the right edge, unclickable (ROK-1918).
 */
async function expectRowsFitViewport(mode: Locator): Promise<void> {
    const widths = await mode.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(widths.scroll, `arrange mode overflows sideways (scrollWidth ${widths.scroll} > clientWidth ${widths.client})`)
        .toBeLessThanOrEqual(widths.client);
    const toggles = mode.locator('ol[aria-label="Overview widgets, in order"] > li button[aria-pressed]');
    expect(await toggles.count(), 'the arrange list renders a Hide/Show button per row').toBeGreaterThan(0);
    const clipped = await toggles.evaluateAll(
        (buttons) => buttons.filter((b) => {
            const r = b.getBoundingClientRect();
            return r.left < 0 || r.right > window.innerWidth;
        }).map((b) => `${b.getAttribute('aria-label') ?? '?'} (right ${Math.round(b.getBoundingClientRect().right)}px > ${window.innerWidth}px)`),
    );
    expect(clipped, 'every row\'s Hide/Show button lies inside the viewport').toEqual([]);
}

async function expectDefaultGrid(page: Page): Promise<void> {
    await expect.poll(() => gridOrder(page, [MOVED_CARD, NEIGHBOUR_CARD, HIDDEN_CARD]), { timeout: 15_000 })
        .toEqual([HIDDEN_CARD, NEIGHBOUR_CARD, MOVED_CARD]);
}

/** Move Attendance above Members summary; asserts the live announcement and the new slot. */
async function moveAttendanceUp(mode: Locator, page: Page): Promise<void> {
    const before = await rowIds(page);
    const from = before.indexOf(`arrange-row-attendance`);
    expect(before[from - 1], 'default order: Members summary (60) sits right above Attendance (70)').toBe('arrange-row-module:members-summary');
    await mode.getByRole('button', { name: 'Move Attendance leaderboard up' }).click();
    await expect(page.getByTestId('arrange-live')).toHaveText(`Attendance leaderboard moved to position ${from} of ${before.length}.`);
    await expect.poll(() => rowIds(page)).toEqual([
        ...before.slice(0, from - 1), 'arrange-row-attendance', 'arrange-row-module:members-summary', ...before.slice(from + 1),
    ]);
}

async function hideEvents(mode: Locator): Promise<void> {
    const row = mode.getByTestId('arrange-row-events');
    await row.getByRole('button', { name: /^Hide / }).click();
    await expect(row, 'a hidden row stays in place, dimmed').toHaveAttribute('data-hidden', 'true');
    await expect(row).toHaveClass(/opacity-60/);
    await expect(row.getByText('Hidden', { exact: true })).toBeVisible();
    const show = row.getByRole('button', { name: /^Show / });
    await expect(show).toBeVisible();
    await expect(show).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Add: if the hub offers an opt-in widget, add the first one and check it lands
 * at the top. A seeded WoW guild has no `defaultOn: false` widget until the
 * generic widgets (L7) ship, so today this asserts the empty picker state.
 */
async function addFromPicker(mode: Locator, page: Page): Promise<string | null> {
    await mode.getByTestId('arrange-add').click();
    const list = page.getByTestId('add-widget-list');
    const empty = page.getByTestId('add-widget-empty');
    // A Modal at >=1024px, a BottomSheet below. A closed sheet stays mounted off-screen (aria-hidden, no role),
    // so assert on the dialog itself, not on its content (ROK-1918 tablet).
    const picker = page.getByRole('dialog', { name: 'Add a widget' });
    await expect(picker).toBeVisible();
    await expect(list.or(empty)).toBeVisible();
    if (await empty.isVisible()) {
        await expect(empty).toHaveText('Every widget this hub offers is already on the Overview.');
        await page.keyboard.press('Escape');
        await expect(picker, 'Escape closes the Add a widget picker').toBeHidden();
        return null;
    }
    const option = list.locator('[data-testid^="add-widget-option-"]').first();
    const id = (await option.getAttribute('data-testid'))?.replace('add-widget-option-', '') ?? '';
    await option.getByRole('button', { name: /^Add / }).click();
    await expect.poll(async () => (await rowIds(page))[0], 'an added widget joins at the top (Q3)').toBe(`arrange-row-${id}`);
    return id;
}

test.describe('Hub Overview arrange (ROK-1918)', () => {
    test('officer arranges the Overview: move up, hide, add, save, reload keeps it, reset restores the default', async ({ page }, testInfo) => {
        await withGuild(testInfo, async (guild) => {
            await openOverviewAs(page, guild, 'officer');
            await expectDefaultGrid(page);

            const mode = await enterArrange(page);
            await expect(page.getByTestId('guild-overview'), 'the grid is replaced by the list while arranging').toBeHidden();
            await expectRowsFitViewport(mode);
            await expect(mode.getByTestId('arrange-row-attendance').getByTestId('arrange-row-owner')).toHaveText('Core');
            await expect(mode.getByTestId('arrange-row-module:members-summary').getByTestId('arrange-row-owner')).toHaveText('World of Warcraft');

            await moveAttendanceUp(mode, page);
            await hideEvents(mode);
            const added = await addFromPicker(mode, page);
            testInfo.annotations.push({ type: 'add-widget', description: added ?? 'no opt-in widget on a seeded WoW hub — empty picker asserted' });

            const saved = widgetPrefsPatch(page, guild.guildId);
            await mode.getByTestId('arrange-save').click();
            expect((await saved).status(), 'PATCH /guilds/:id/widget-prefs').toBe(200);
            await expect(mode).toBeHidden();
            await expect.poll(() => gridOrder(page, [MOVED_CARD, NEIGHBOUR_CARD, HIDDEN_CARD]), { timeout: 15_000 })
                .toEqual([MOVED_CARD, NEIGHBOUR_CARD]);

            await page.reload();
            await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
            await expect.poll(() => gridOrder(page, [MOVED_CARD, NEIGHBOUR_CARD, HIDDEN_CARD]), { timeout: 15_000 })
                .toEqual([MOVED_CARD, NEIGHBOUR_CARD]);

            const again = await enterArrange(page);
            await expect(again.getByTestId('arrange-row-events'), 'the saved hide survives the reload').toHaveAttribute('data-hidden', 'true');
            await again.getByTestId('arrange-reset').click();
            const reset = widgetPrefsPatch(page, guild.guildId);
            await page.getByRole('button', { name: 'Reset', exact: true }).click();
            expect((await reset).status(), 'PATCH { reset: true }').toBe(200);
            await expect(again).toBeHidden();
            await expectDefaultGrid(page);
        });
    });

    test('a plain member sees the Overview with no Arrange button', async ({ page }, testInfo) => {
        await withGuild(testInfo, async (guild) => {
            await openOverviewAs(page, guild, 'member');
            // Attendance needs the raids query, the same one the Arrange gate waits on — so the page has settled.
            await expectDefaultGrid(page);
            await expect(page.getByTestId('hub-arrange'), 'Arrange follows viewer.canEdit (spec §1.3)').toHaveCount(0);
            await expect(page.getByTestId('hub-arrange-mode')).toHaveCount(0);
        });
    });
});
