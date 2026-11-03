/**
 * ROK-1940 (AC-7): Admin → Discord → Features → "Voice attendance" card.
 *
 * CI has no connected bot (the Features cards only render when it is), so the
 * bot status is stubbed as connected; the voice-attendance endpoints are REAL.
 *
 * The grace is ONE global setting and both projects share the DB, so only the
 * desktop project saves (a concurrent mobile save would race the reload
 * assertion). Both projects check the render and the inline range error, which
 * never reaches the API. The save restores the original value afterwards so
 * other specs keep the 5-minute default.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPut, getAdminToken, pollForCondition } from './api-helpers';

const FEATURES = '/admin/settings/discord/features';
const SETTINGS = '/admin/settings/voice-attendance';
const RANGE_ERROR = 'Enter a whole number from 0 to 60.';

async function readGrace(token: string): Promise<number | null> {
    const body: unknown = await apiGet(token, SETTINGS);
    const grace = (body as { graceMinutes?: unknown } | null)?.graceMinutes;
    return typeof grace === 'number' ? grace : null;
}

/** Stub only the bot status as connected so the Features cards render. */
async function openFeatures(page: Page): Promise<void> {
    await page.route((url) => url.pathname.endsWith('/admin/settings/discord-bot'), async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as Record<string, unknown>;
        await route.fulfill({ response: res, json: { ...body, connected: true } });
    });
    await page.goto(FEATURES);
}

const card = (page: Page) => page.getByTestId('voice-attendance-section');
const graceInput = (page: Page) => card(page).getByRole('spinbutton', { name: 'Late after (minutes)' });

test.describe('Admin Discord — Voice attendance grace (ROK-1940)', () => {
    test('renders the stored grace; out-of-range input errors inline without a PUT', async ({ page }) => {
        const token = await getAdminToken();
        const stored = await pollForCondition(async () => {
            const g = await readGrace(token);
            return g === null ? null : { g };
        }, { description: `${SETTINGS} readable` });
        const puts: string[] = [];
        page.on('request', (req) => {
            if (req.method() === 'PUT' && req.url().includes(SETTINGS)) puts.push(req.url());
        });
        await openFeatures(page);

        await expect(card(page).getByRole('heading', { name: 'Voice attendance' })).toBeVisible({ timeout: 15_000 });
        await expect(graceInput(page)).toHaveValue(/^\d+$/);
        if (test.info().project.name === 'desktop') await expect(graceInput(page)).toHaveValue(String(stored.g));

        for (const bad of ['61', '-1', '2.5']) {
            await graceInput(page).fill(bad);
            await card(page).getByRole('button', { name: 'Save' }).click();
            await expect(card(page).getByRole('alert')).toHaveText(RANGE_ERROR);
            await expect(graceInput(page)).toHaveAttribute('aria-invalid', 'true');
        }
        expect(puts).toEqual([]);
    });

    test('a valid save toasts, persists in the API and survives reload', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'global setting — saved from one project only (see header)');
        const token = await getAdminToken();
        const original = await readGrace(token);
        if (original === null) throw new Error(`${SETTINGS} returned no graceMinutes`);
        const target = original === 17 ? 18 : 17;
        try {
            await openFeatures(page);
            await expect(graceInput(page)).toHaveValue(String(original), { timeout: 15_000 });
            await graceInput(page).fill(String(target));
            await card(page).getByRole('button', { name: 'Save' }).click();
            await expect(page.getByText('Voice attendance grace saved.')).toBeVisible();

            await pollForCondition(async () => ((await readGrace(token)) === target ? true : null), {
                description: `${SETTINGS} graceMinutes === ${target}`,
            });
            await page.reload();
            await expect(graceInput(page)).toHaveValue(String(target), { timeout: 15_000 });
        } finally {
            await apiPut(token, SETTINGS, { graceMinutes: original });
        }
    });
});
