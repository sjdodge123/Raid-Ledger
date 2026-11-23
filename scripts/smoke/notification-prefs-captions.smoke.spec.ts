/**
 * Notification settings captions smoke tests (ROK-2290).
 *
 * /profile/notifications shows a hint line that the bell and Discord switches
 * are separate, and each row reads "Discord DM only" (bell off + Discord on) or
 * "Muted" (every visible channel off).
 *
 * Fixtures: every test seeds its OWN member (`seed-non-guild-user`, Discord DMs
 * muted) and signs the page in as that member. `PATCH /notifications/preferences`
 * replaces the user's whole merged channel matrix, so the parallel desktop /
 * mobile / tablet projects (and CI shards) must never share one preference row —
 * a per-test user is the only race-free setup. The member is deleted in
 * `finally`, which takes its preference row with it; no shared state is touched.
 *
 * The Discord column renders only when `GET /notifications/channels` reports
 * Discord available (a linked Discord id AND the bot up). GitHub CI has no bot,
 * so the spec fixtures that endpoint with `page.route` to "available": the
 * column always renders and bell off + Discord on must read "Discord DM only".
 */
import { test, expect } from './base';
import { getAdminToken, apiGet, apiPatch, apiPost, apiDelete } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

type ChannelPrefs = { inApp: boolean; push: boolean; discord: boolean };

const ROW = { type: 'gg_ready', label: 'Your GG of the year' };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

async function createMember(adminToken: string): Promise<number> {
    const body: unknown = await apiPost(adminToken, '/admin/test/seed-non-guild-user', { quietDms: true });
    const id = isRecord(body) ? body['userId'] : undefined;
    if (typeof id !== 'number') throw new Error(`seed-non-guild-user: ${JSON.stringify(body)}`);
    return id;
}

async function readPrefs(token: string, type: string): Promise<ChannelPrefs | undefined> {
    const res = (await apiGet(token, '/notifications/preferences')) as
        | { channelPrefs?: Record<string, ChannelPrefs> }
        | null;
    expect(res, 'GET /notifications/preferences must answer 2xx').not.toBeNull();
    return res?.channelPrefs?.[type];
}

test.describe('Notification settings captions', () => {
    test('the hint line renders and turning the bell off captions the row', async ({ page }) => {
        const adminToken = await getAdminToken();
        const userId = await createMember(adminToken);
        try {
            const jwt = await signInOnboardedMember(page, userId);
            await apiPatch(jwt, '/notifications/preferences', {
                channelPrefs: { [ROW.type]: { inApp: true, push: false, discord: true } },
            });
            await expect.poll(async () => (await readPrefs(jwt, ROW.type))?.inApp, {
                message: 'the bell-on setup must reach the API before the page loads',
            }).toBe(true);
            await page.route('**/notifications/channels', (route) =>
                route.fulfill({ json: { discord: { available: true } } }),
            );
            await page.goto(`/profile/notifications#notif-${ROW.type}`);
            await expect(page.getByTestId('notif-channels-hint'), 'the hint line must render under the subtitle')
                .toContainText('The bell and Discord switches are separate', { timeout: 15_000 });

            const rowEl = page.locator(`#notif-${ROW.type}`);
            await expect(rowEl, 'the notification-type row must render').toBeVisible({ timeout: 15_000 });
            const caption = rowEl.getByTestId('notif-row-caption');
            await expect(caption, 'a bell-on row carries no caption').toHaveCount(0);

            const patched = page.waitForResponse(
                (r) => r.url().includes('/notifications/preferences') && r.request().method() === 'PATCH',
            );
            await rowEl.getByRole('button', { name: `Disable ${ROW.label} inApp notifications` }).click();
            expect((await patched).ok(), 'the bell toggle PATCH must succeed').toBe(true);

            await expect(caption, 'bell off + Discord on must caption the row "Discord DM only"')
                .toHaveText('Discord DM only');
            await expect.poll(async () => (await readPrefs(jwt, ROW.type))?.inApp, {
                message: 'the bell-off switch must reach the API',
            }).toBe(false);
        } finally {
            await apiDelete(adminToken, `/users/${userId}`).catch(() => undefined);
        }
    });
});
