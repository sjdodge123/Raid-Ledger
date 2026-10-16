/**
 * Per-game notification mute smoke tests (ROK-1797).
 *
 * Covers the bell on the game page (popover on desktop, BottomSheet below
 * 1024px), the `?action=notifications` deep link, the muted-games list on
 * /profile/notifications, and the legacy /profile/preferences/notifications
 * redirect that keeps its search + hash and lands on a focused `#notif-<type>`
 * row.
 *
 * Fixtures: no game is created. The spec reads `GET /games/discover` and picks
 * a game by id (never by name, which IGDB can rewrite), one per project so the
 * parallel desktop / mobile / tablet projects never mute the same row. The
 * browser session is the shared admin storage state, and the mute is a per-user
 * row, so every test starts from and ends at "not muted" through the same
 * admin token the API helpers use (DELETE is idempotent).
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import { getAdminToken, apiGet, apiPost, apiDelete } from './api-helpers';
import { isPhoneLayout } from './helpers';
import { defined } from './defined';

const PROJECT_ORDER = ['desktop', 'mobile', 'tablet'];

interface DiscoverResponse {
    rows?: Array<{ games?: Array<{ id: number }> }>;
}

/** A game id from the API, offset by project so parallel projects don't collide. */
async function pickGameId(token: string, projectName: string): Promise<number> {
    const res = (await apiGet(token, '/games/discover')) as DiscoverResponse | null;
    expect(res, 'GET /games/discover must answer 2xx with a body').not.toBeNull();
    const ids = [...new Set((res?.rows ?? []).flatMap((r) => (r.games ?? []).map((g) => g.id)))];
    expect(ids.length, 'GET /games/discover must return at least one game to mute').toBeGreaterThan(0);
    const offset = Math.max(0, PROJECT_ORDER.indexOf(projectName));
    return defined(ids[offset % ids.length], 'a discoverable game id');
}

async function unmuteViaApi(token: string, gameId: number): Promise<void> {
    await apiDelete(token, `/games/${gameId}/notification-mute`);
}

async function mutedGameIds(token: string): Promise<number[]> {
    const res = (await apiGet(token, '/notifications/game-mutes')) as { data?: Array<{ gameId: number }> } | null;
    expect(res, 'GET /notifications/game-mutes must answer 2xx').not.toBeNull();
    return (res?.data ?? []).map((g) => g.gameId);
}

/** The panel is a popover at/above 1024px and a BottomSheet dialog below it. */
function panelFor(page: Page, phone: boolean) {
    return phone ? page.getByRole('dialog', { name: /^Notifications for / }) : page.getByTestId('game-notify-popover');
}

test.describe('Game notification mute', () => {
    let token = '';
    let gameId = 0;

    test.beforeEach(async ({}, testInfo) => {
        token = await getAdminToken();
        gameId = await pickGameId(token, testInfo.project.name);
        await unmuteViaApi(token, gameId);
    });

    test.afterEach(async () => {
        if (token && gameId) await unmuteViaApi(token, gameId);
    });

    test('the bell opens the panel; muting persists across a reload', async ({ page }, testInfo) => {
        const phone = isPhoneLayout(testInfo);
        await page.goto(`/games/${gameId}`);
        const bell = page.getByTestId('game-notify-bell');
        await expect(bell, 'the bell must render for a signed-in viewer').toBeVisible({ timeout: 15_000 });
        await expect(bell).toHaveAttribute('aria-label', /: on$/);

        await bell.click();
        const panel = panelFor(page, phone);
        await expect(panel, 'clicking the bell must open the panel').toBeVisible();

        const toggle = panel.getByTestId('game-notify-switch');
        await expect(toggle, 'a fresh game starts with notifications on').toHaveAttribute('aria-checked', 'true');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await expect.poll(() => mutedGameIds(token), { message: 'the mute must reach the API' }).toContain(gameId);

        await page.reload();
        const reloadedBell = page.getByTestId('game-notify-bell');
        await expect(reloadedBell, 'the mute must survive a reload').toHaveAttribute('aria-label', /: muted$/, {
            timeout: 15_000,
        });
        await reloadedBell.click();
        await expect(panelFor(page, phone).getByTestId('game-notify-switch')).toHaveAttribute('aria-checked', 'false');
    });

    test('?action=notifications opens the panel on load and is stripped from the URL', async ({ page }, testInfo) => {
        await page.goto(`/games/${gameId}?action=notifications`);
        await expect(
            panelFor(page, isPhoneLayout(testInfo)),
            'the deep link must open the panel without a click',
        ).toBeVisible({ timeout: 15_000 });
        await expect(page, 'the action param must be stripped once handled').not.toHaveURL(/[?&]action=/);
        expect(new URL(page.url()).pathname).toBe(`/games/${gameId}`);
    });

    test('/profile/notifications lists a muted game and Unmute removes it', async ({ page }) => {
        await apiPost(token, `/games/${gameId}/notification-mute`);

        await page.goto('/profile/notifications');
        const list = page.getByTestId('muted-games-list');
        await expect(list, 'the muted-games list must render under Subscribed Games').toBeVisible({ timeout: 15_000 });
        const item = list.locator('li', { has: page.locator(`a[href="/games/${gameId}"]`) });
        await expect(item, 'the muted game must be listed').toHaveCount(1);

        await item.getByRole('button', { name: /^Unmute/ }).click();
        await expect(item, 'Unmute must remove the game from the list').toHaveCount(0);
        await expect.poll(() => mutedGameIds(token), { message: 'the unmute must reach the API' }).not.toContain(gameId);
    });

    test('legacy preferences URL redirects keeping search + hash and focuses the row', async ({ page }) => {
        await page.goto('/profile/preferences/notifications?type=subscribed_game#notif-subscribed_game');
        await expect(page).toHaveURL(/\/profile\/notifications\?type=subscribed_game#notif-subscribed_game$/, {
            timeout: 15_000,
        });
        await expect(
            page.locator('#notif-subscribed_game'),
            'the anchored notification-type row must receive focus once the preferences load',
        ).toBeFocused({ timeout: 15_000 });
    });
});
