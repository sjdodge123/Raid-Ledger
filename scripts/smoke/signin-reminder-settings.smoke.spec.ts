/**
 * ROK-2284: Admin → Discord → Features → "Sign-in reminders" card.
 *
 * CI has no connected bot (the Features cards only render when it is), so the
 * bot status is stubbed as connected; the sign-in reminder endpoints are REAL
 * on desktop (pattern: `voice-attendance-grace.smoke.spec.ts`).
 *
 * The settings are global and both projects share the DB, so only the desktop
 * project writes them (a concurrent mobile save would race the reload
 * assertion) and restores the starting values afterwards. The switch is
 * flipped and flipped straight back: left ON in a fleet env, the hourly cron
 * would DM real members of the test guild. The mobile project drives the same
 * toggle → save → reload flow against a stubbed endpoint, so the phone layout
 * is covered without touching the shared settings. Both projects check the
 * inline range errors, which never reach the API.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPut, getAdminToken, pollForCondition } from './api-helpers';

const FEATURES = '/admin/settings/discord/features';
const SETTINGS = '/admin/settings/signin-reminder';
const WEEKS_ERROR = 'Enter a whole number from 1 to 12.';
const MAX_ERROR = 'Enter a whole number from 1 to 10.';
const SAVED = 'Sign-in reminder settings saved.';

interface ReminderSettings { enabled: boolean; weeks: number; max: number }

function isReminderSettings(body: unknown): body is ReminderSettings {
    if (typeof body !== 'object' || body === null) return false;
    if (!('enabled' in body) || !('weeks' in body) || !('max' in body)) return false;
    return typeof body.enabled === 'boolean' && typeof body.weeks === 'number' && typeof body.max === 'number';
}

async function readSettings(token: string): Promise<ReminderSettings | null> {
    const body: unknown = await apiGet(token, SETTINGS);
    return isReminderSettings(body) ? body : null;
}

const isSettingsUrl = (url: URL) => url.pathname.endsWith(SETTINGS);

/** Stub only the bot status as connected so the Features cards render. */
async function openFeatures(page: Page): Promise<void> {
    await page.route((url) => url.pathname.endsWith('/admin/settings/discord-bot'), async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as Record<string, unknown>;
        await route.fulfill({ response: res, json: { ...body, connected: true } });
    });
    await page.goto(FEATURES);
}

/** Mobile: an in-memory GET/PUT for the settings (survives a reload). */
async function stubSettings(page: Page, start: ReminderSettings): Promise<{ puts: unknown[] }> {
    let state = { ...start };
    const puts: unknown[] = [];
    await page.route(isSettingsUrl, async (route) => {
        if (route.request().method() === 'PUT') {
            const body: unknown = route.request().postDataJSON();
            puts.push(body);
            if (isReminderSettings(body)) state = { ...body };
        }
        await route.fulfill({ json: state });
    });
    return { puts };
}

const card = (page: Page) => page.getByTestId('signin-reminder-section');
const toggle = (page: Page) => card(page).getByRole('switch', { name: "Remind members who haven't signed in" });
const weeksInput = (page: Page) => card(page).getByRole('spinbutton', { name: 'Remind every (weeks)' });
const maxInput = (page: Page) => card(page).getByRole('spinbutton', { name: 'At most (reminders)' });
const save = (page: Page) => card(page).getByRole('button', { name: 'Save' });
const toastFor = (on: boolean) => (on ? 'Sign-in reminders turned on.' : 'Sign-in reminders turned off.');

async function expectCard(page: Page, s: ReminderSettings): Promise<void> {
    await expect(card(page).getByRole('heading', { name: 'Sign-in reminders' })).toBeVisible({ timeout: 15_000 });
    await expect(toggle(page)).toHaveAttribute('aria-checked', String(s.enabled), { timeout: 15_000 });
    await expect(weeksInput(page)).toHaveValue(String(s.weeks));
    await expect(maxInput(page)).toHaveValue(String(s.max));
}

/** Save new weeks/max through the form and wait for the toast. */
async function saveNumbers(page: Page, weeks: number, max: number): Promise<void> {
    await weeksInput(page).fill(String(weeks));
    await maxInput(page).fill(String(max));
    await save(page).click();
    await expect(page.getByText(SAVED)).toBeVisible();
}

test.describe('Admin Discord — Sign-in reminders (ROK-2284)', () => {
    test('renders the stored settings; out-of-range input errors inline without a PUT', async ({ page }) => {
        const token = await getAdminToken();
        const stored = await pollForCondition(async () => readSettings(token), { description: `${SETTINGS} readable` });
        const puts: string[] = [];
        page.on('request', (req) => {
            if (req.method() === 'PUT' && req.url().includes(SETTINGS)) puts.push(req.url());
        });
        await openFeatures(page);
        await expect(card(page).getByRole('heading', { name: 'Sign-in reminders' })).toBeVisible({ timeout: 15_000 });
        await expect(weeksInput(page)).toHaveValue(/^\d+$/);
        if (test.info().project.name === 'desktop') await expectCard(page, stored);

        for (const bad of ['13', '0', '2.5']) {
            await weeksInput(page).fill(bad);
            await save(page).click();
            await expect(card(page).getByRole('alert')).toHaveText(WEEKS_ERROR);
            await expect(weeksInput(page)).toHaveAttribute('aria-invalid', 'true');
        }
        await weeksInput(page).fill('3');
        await maxInput(page).fill('11');
        await save(page).click();
        await expect(card(page).getByRole('alert')).toHaveText(MAX_ERROR);
        await expect(maxInput(page)).toHaveAttribute('aria-invalid', 'true');
        expect(puts).toEqual([]);
    });

    test('desktop: toggle and save persist in the API and survive reload', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'global settings — written from one project only (see header)');
        const token = await getAdminToken();
        const original = await readSettings(token);
        if (original === null) throw new Error(`${SETTINGS} returned no settings`);
        const target = { weeks: original.weeks === 5 ? 6 : 5, max: original.max === 4 ? 5 : 4 };
        try {
            await openFeatures(page);
            await expectCard(page, original);
            for (const on of [!original.enabled, original.enabled]) {
                await toggle(page).click();
                await expect(page.getByText(toastFor(on)).first()).toBeVisible();
                await pollForCondition(async () => ((await readSettings(token))?.enabled === on ? true : null), {
                    description: `${SETTINGS} enabled === ${String(on)}`,
                });
            }
            await saveNumbers(page, target.weeks, target.max);
            await pollForCondition(async () => {
                const s = await readSettings(token);
                return s?.weeks === target.weeks && s.max === target.max ? s : null;
            }, { description: `${SETTINGS} weeks/max saved` });
            await page.reload();
            await expectCard(page, { enabled: original.enabled, ...target });
        } finally {
            await apiPut(token, SETTINGS, { ...original });
        }
    });

    test('phone: toggle → save → reload against a stubbed endpoint', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'desktop writes the real settings (see header)');
        const start: ReminderSettings = { enabled: false, weeks: 3, max: 3 };
        const stub = await stubSettings(page, start);
        await openFeatures(page);
        await expectCard(page, start);
        await toggle(page).click();
        await expect(page.getByText(toastFor(true))).toBeVisible();
        await saveNumbers(page, 8, 6);
        expect(stub.puts).toEqual([{ ...start, enabled: true }, { enabled: true, weeks: 8, max: 6 }]);
        await page.reload();
        await expectCard(page, { enabled: true, weeks: 8, max: 6 });
    });
});
