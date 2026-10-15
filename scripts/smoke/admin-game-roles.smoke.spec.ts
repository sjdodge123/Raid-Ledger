/**
 * ROK-1767 (L3): Discord Features → Game roles — link a game, the row appears.
 *
 * CI has no connected bot (the Features sections only render when it is), and
 * linking a role needs a live guild, so this spec stubs the bot status as
 * connected and serves the game-role endpoints from an in-memory list. The real
 * API (preflight, role creation, reconcile) is covered by the integration specs
 * and the companion-bot smoke `tools/test-bot/src/smoke/tests/game-role.test.ts`;
 * this spec proves the admin flow: game search (real), role pick, window,
 * preflight gate, Save, row rendered. Runs on desktop (Modal) and mobile
 * (BottomSheet) alike — the Save button carries the same test id in both.
 */
import type { Page, Route } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, getAdminToken } from './api-helpers';

const BOT = '/admin/settings/discord-bot';
const GAME_ROLES = `${BOT}/game-roles`;

interface Row {
    gameId: number; gameName: string; roleId: string; roleName: string; botCreated: boolean;
    windowDays: number; enabled: boolean; lastReconciledAt: null; grantedCount: number;
}

/** A configured game's name to type into the real game search. */
async function pickSeededGameName(): Promise<string> {
    const token = await getAdminToken();
    const body = await apiGet(token, '/games/configured');
    const list: { name?: unknown }[] = Array.isArray(body) ? body : (body?.data ?? []);
    const name = list.find((g) => typeof g.name === 'string' && g.name.length >= 3)?.name;
    if (typeof name !== 'string') throw new Error('No configured game to link in the seed (/games/configured empty)');
    return name;
}

/** Serves the game-role REST surface from `rows`; PUT appends the linked game. */
async function stubGameRoles(page: Page, rows: Row[], gameNameFor: () => string): Promise<void> {
    await page.route((url) => url.pathname.endsWith(BOT), async (route: Route) => {
        const res = await route.fetch();
        const body = (await res.json()) as Record<string, unknown>;
        await route.fulfill({ response: res, json: { ...body, connected: true } });
    });
    await page.route((url) => url.pathname.endsWith(`${BOT}/roles`), (route) => route.fulfill({ json: [] }));
    await page.route((url) => url.pathname.includes(GAME_ROLES), async (route) => {
        const { pathname } = new URL(route.request().url());
        const method = route.request().method();
        if (pathname.endsWith('/preflight')) return route.fulfill({ json: { ok: true, problems: [] } });
        if (pathname.includes('/audit')) return route.fulfill({ json: [] });
        if (method === 'PUT') {
            const gameId = Number(pathname.split('/').pop());
            const reqBody = route.request().postDataJSON() as { windowDays: number };
            const row: Row = {
                gameId, gameName: gameNameFor(), roleId: 'smoke-role', roleName: gameNameFor(), botCreated: true,
                windowDays: reqBody.windowDays, enabled: true, lastReconciledAt: null, grantedCount: 0,
            };
            rows.push(row);
            return route.fulfill({ json: row });
        }
        return route.fulfill({ json: rows });
    });
}

test.describe('Admin Discord — Game roles (ROK-1767)', () => {
    test('link a game → its row appears in the Game roles list', async ({ page }) => {
        const gameName = await pickSeededGameName();
        const rows: Row[] = [];
        await stubGameRoles(page, rows, () => gameName);
        await page.goto('/admin/settings/discord/features');

        const section = page.getByTestId('game-roles-section');
        await expect(section.getByRole('heading', { name: 'Game roles' })).toBeVisible({ timeout: 15_000 });
        await expect(section.getByText(/No games linked yet/)).toBeVisible();

        await section.getByRole('button', { name: 'Link game' }).click();
        const dialog = page.getByRole('dialog', { name: 'Link game to a role' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('combobox', { name: 'Game' }).fill(gameName);
        await page.getByRole('option', { name: gameName, exact: true }).first().click();
        await expect(dialog.getByRole('combobox', { name: 'Discord role' })).toHaveValue('__create__');
        await expect(dialog.getByRole('spinbutton', { name: 'Inactivity window (days)' })).toHaveValue('14');

        const save = page.getByTestId('game-role-save');
        await expect(save).toBeEnabled();
        await save.click();

        await expect(dialog).toBeHidden();
        const row = section.locator('[data-testid^="game-role-row-"]');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText(gameName);
        await expect(row).toContainText('14-day window · 0 granted');
        expect(rows).toHaveLength(1);
    });
});
