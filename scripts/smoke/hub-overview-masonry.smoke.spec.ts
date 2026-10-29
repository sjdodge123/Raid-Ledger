/**
 * Hub Overview masonry smoke (ROK-2043) — desktop AND mobile projects.
 *
 * Seeds its own WoW guild hub through the DEMO_MODE fixture
 * `POST /admin/test/wow/seed-guild` (the seed `hub-arrange-widgets` uses: a
 * weekly series and a past raid with attendance, so several differently tall
 * cards render) and opens the Overview as the plain member.
 *
 * Desktop + tablet projects (≥768px: three columns at lg, two at md): two
 * row-mates keep their OWN heights (more than one gap apart — under the old
 * stretched rows they were equal), and the card below the shorter one starts
 * ABOVE the taller one's bottom edge, i.e. it slid up into the space a uniform
 * row height left empty. Every card also sits one gap under the card above it.
 * Mobile (one column): no inline masonry placement, a plain stack.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

/** `gap-4` on the Overview grid. */
const GRID_GAP_PX = 16;
/** The 2px row track: a span rounds a card's height + gap up by < one track. */
const ROUNDING_PX = 2;

interface SeededGuild {
    guildId: number;
    users: Record<string, { userId: number }>;
}

interface CellBox {
    id: string;
    left: number;
    right: number;
    top: number;
    bottom: number;
    rowEnd: string;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const name = `Masonry ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    return { guildId: body.guildId, users: body.users };
}

async function openOverviewAsMember(page: Page, guild: SeededGuild): Promise<void> {
    const member = guild.users['member'];
    if (!member) throw new Error('seed-guild returned no member user');
    await signInOnboardedMember(page, member.userId);
    await page.goto(`/hubs/${guild.guildId}`);
    await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
    // Two differently tall cards on the first row: the case a uniform row height got wrong.
    await expect(page.locator('#guild-events')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#guild-attendance')).toBeVisible({ timeout: 15_000 });
}

/** A card that slid up: `below` sits under `shorter`, starting above the bottom of `shorter`'s taller row-mate. */
interface SlideUp {
    shorter: CellBox;
    taller: CellBox;
    below: CellBox;
}

const overlapsColumns = (a: CellBox, b: CellBox): boolean => a.left < b.right - 1 && a.right > b.left + 1;

/** Side-by-side cards on one row whose heights differ by more than a gap; `[]` on a stretched (row-height) grid. */
function unequalRowMates(cells: readonly CellBox[]): Array<{ shorter: CellBox; taller: CellBox }> {
    return cells.flatMap((shorter) => cells.flatMap((taller) => {
        const rowMates = Math.abs(shorter.top - taller.top) <= ROUNDING_PX && !overlapsColumns(shorter, taller);
        return rowMates && taller.bottom - taller.top - (shorter.bottom - shorter.top) > GRID_GAP_PX ? [{ shorter, taller }] : [];
    }));
}

/** Every slide-up: the card directly below the shorter row-mate starts above the taller one's bottom edge. */
function slideUps(cells: readonly CellBox[]): SlideUp[] {
    return unequalRowMates(cells).flatMap(({ shorter, taller }) => {
        const below = cells.find((b) => b !== shorter && overlapsColumns(b, shorter) && b.top >= shorter.bottom - 0.5
            && !overlapsColumns(b, taller) && b.top < taller.bottom);
        return below ? [{ shorter, taller, below }] : [];
    });
}

/** The grid's rendered direct children (an empty cell has no height and is skipped), relative to the grid top. */
function cellBoxes(page: Page): Promise<CellBox[]> {
    return page.getByTestId('guild-overview').evaluate((grid) => {
        const top = grid.getBoundingClientRect().top;
        return Array.from(grid.children).flatMap((c, i) => {
            const r = c.getBoundingClientRect();
            if (r.height <= 0 || !(c instanceof HTMLElement)) return [];
            const id = c.id || c.querySelector('[id]')?.id || c.getAttribute('data-testid') || `cell-${i}`;
            return [{ id, left: r.left, right: r.right,
                top: r.top - top, bottom: r.bottom - top, rowEnd: c.style.getPropertyValue('grid-row-end') }];
        });
    });
}

/** Every packing violation, as a readable line; `[]` when the Overview is packed. */
function packingViolations(cells: readonly CellBox[]): string[] {
    return cells.flatMap((cell) => {
        const above = cells.filter((o) => o !== cell && o.bottom <= cell.top + 0.5 && overlapsColumns(o, cell));
        if (above.length === 0) {
            return cell.top > ROUNDING_PX ? [`${cell.id}: nothing above it, yet it starts ${Math.round(cell.top)}px below the grid top`] : [];
        }
        const gap = cell.top - Math.max(...above.map((o) => o.bottom));
        if (gap > GRID_GAP_PX + ROUNDING_PX) return [`${cell.id}: ${gap.toFixed(1)}px hole above it (max ${GRID_GAP_PX + ROUNDING_PX}px)`];
        if (gap < GRID_GAP_PX - 0.5) return [`${cell.id}: only ${gap.toFixed(1)}px below the card above (min ${GRID_GAP_PX}px)`];
        return [];
    });
}

test.describe('Hub Overview masonry (ROK-2043)', () => {
    test('desktop: a card slides up under its shorter row-mate instead of waiting for the taller one', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Multi-column (desktop + tablet) — mobile is the next test');
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        try {
            await openOverviewAsMember(page, guild);
            // Behaviour, not implementation: on a row-height grid row-mates stretch equal, so both polls stay [].
            await expect.poll(async () => unequalRowMates(await cellBoxes(page)).map((p) => `${p.shorter.id} / ${p.taller.id}`), {
                message: 'two side-by-side row-mates keep their own heights (differ by more than the 16px gap)', timeout: 15_000,
            }).not.toEqual([]);
            await expect.poll(async () => slideUps(await cellBoxes(page)).map((s) => `${s.below.id} under ${s.shorter.id}, beside ${s.taller.id}`), {
                message: 'some card starts under a shorter row-mate, above the taller row-mate\'s bottom edge', timeout: 15_000,
            }).not.toEqual([]);
            await expect.poll(async () => packingViolations(await cellBoxes(page)), { timeout: 15_000 }).toEqual([]);
            const cells = await cellBoxes(page);
            expect(new Set(cells.map((c) => Math.round(c.left))).size, 'the Overview lays cards out in several columns')
                .toBeGreaterThan(1);
        } finally {
            for (const user of Object.values(guild.users)) await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    });

    test('mobile: no masonry spans — one plain stack in arranged order', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'mobile', 'Mobile-only — the phone stack; desktop is the previous test');
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        try {
            await openOverviewAsMember(page, guild);
            const cells = await cellBoxes(page);
            expect(cells.filter((c) => c.rowEnd !== '').map((c) => `${c.id} (${c.rowEnd})`), 'no inline row span below md').toEqual([]);
            expect(new Set(cells.map((c) => Math.round(c.left))).size, 'one column on a phone').toBe(1);
            const outOfOrder = cells.slice(1).filter((c, i) => {
                const prev = cells[i];
                return prev === undefined || c.top < prev.bottom;
            });
            expect(outOfOrder.map((c) => c.id), 'each card sits below the previous one, in DOM order').toEqual([]);
        } finally {
            for (const user of Object.values(guild.users)) await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    });
});
