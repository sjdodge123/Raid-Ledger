/**
 * Notification settings captions smoke tests (ROK-2290).
 *
 * /profile/notifications shows a hint line that the bell and Discord switches
 * are separate, and each row reads "Discord DM only" (bell off + Discord on) or
 * "Muted" (every visible channel off).
 *
 * The browser session is the shared admin storage state. Whether the Discord
 * column renders depends on the env (admin has Discord linked AND the bot is
 * up), so the spec reads `GET /notifications/channels` and asserts the caption
 * that is reachable: "Discord DM only" with the column, "Muted" without it.
 *
 * Fixtures: each project owns one notification type so the parallel desktop /
 * mobile / tablet projects never flip the same row. The spec sets the row to
 * bell on / push off / Discord on through the API first and restores the
 * row's original switches afterwards.
 */
import { test, expect } from './base';
import { getAdminToken, apiGet, apiPatch } from './api-helpers';

type ChannelPrefs = { inApp: boolean; push: boolean; discord: boolean };

/** One notification type (and its row label) per project, so parallel projects never collide. */
const TYPE_BY_PROJECT: Record<string, { type: string; label: string }> = {
    desktop: { type: 'gg_ready', label: 'Your GG of the year' },
    mobile: { type: 'calendar_needs_reconnect', label: 'Calendar needs reconnecting' },
    tablet: { type: 'lfg_invite', label: 'LFG group forming' },
};
const FALLBACK = { type: 'gg_ready', label: 'Your GG of the year' };

async function readPrefs(token: string, type: string): Promise<ChannelPrefs | undefined> {
    const res = (await apiGet(token, '/notifications/preferences')) as
        | { channelPrefs?: Record<string, ChannelPrefs> }
        | null;
    expect(res, 'GET /notifications/preferences must answer 2xx').not.toBeNull();
    return res?.channelPrefs?.[type];
}

async function discordColumnShown(token: string): Promise<boolean> {
    const res = (await apiGet(token, '/notifications/channels')) as { discord?: { available?: boolean } } | null;
    return res?.discord?.available ?? false;
}

test.describe('Notification settings captions', () => {
    let token = '';
    let row = FALLBACK;
    let original: ChannelPrefs | undefined;

    test.beforeEach(async ({}, testInfo) => {
        token = await getAdminToken();
        row = TYPE_BY_PROJECT[testInfo.project.name] ?? FALLBACK;
        original = await readPrefs(token, row.type);
        await apiPatch(token, '/notifications/preferences', {
            channelPrefs: { [row.type]: { inApp: true, push: false, discord: true } },
        });
    });

    test.afterEach(async () => {
        if (token && original) {
            await apiPatch(token, '/notifications/preferences', { channelPrefs: { [row.type]: original } });
        }
    });

    test('the hint line renders and turning the bell off captions the row', async ({ page }) => {
        const discordShown = await discordColumnShown(token);
        await page.goto(`/profile/notifications#notif-${row.type}`);

        await expect(page.getByTestId('notif-channels-hint'), 'the hint line must render under the subtitle')
            .toContainText('The bell and Discord switches are separate', { timeout: 15_000 });

        const rowEl = page.locator(`#notif-${row.type}`);
        await expect(rowEl, 'the notification-type row must render').toBeVisible({ timeout: 15_000 });
        const caption = rowEl.getByTestId('notif-row-caption');
        await expect(caption, 'a bell-on row carries no caption').toHaveCount(0);

        const patched = page.waitForResponse(
            (r) => r.url().includes('/notifications/preferences') && r.request().method() === 'PATCH',
        );
        await rowEl.getByRole('button', { name: `Disable ${row.label} inApp notifications` }).click();
        expect((await patched).ok(), 'the bell toggle PATCH must succeed').toBe(true);

        // With the Discord column shown, bell off + Discord on reads "Discord DM only".
        // Without it, the only visible channels (bell, push) are both off, so the row reads "Muted".
        const expected = discordShown ? 'Discord DM only' : 'Muted';
        await expect(caption, `bell off must caption the row "${expected}"`).toHaveText(expected);
        await expect.poll(async () => (await readPrefs(token, row.type))?.inApp, {
            message: 'the bell-off switch must reach the API',
        }).toBe(false);
    });
});
