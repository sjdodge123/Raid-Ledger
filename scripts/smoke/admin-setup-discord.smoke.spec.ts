/**
 * Setup wizard — Discord step (ROK-1703) — desktop + mobile.
 *
 * OQ-4: nothing here reaches Discord. Every endpoint that would call Discord
 * (bot status, setup status, invite URL, permissions, channels) and every
 * wizard write (step, channel, complete) is answered by `page.route`, so the
 * spec never changes server state and needs no reset. Live Discord is an
 * OPERATOR step in the fleet test plan.
 *
 * Covered: a fresh start 4a → 4b → 4c (Back to 4b), the 4c live checks
 * (`oauth/test` with the typed pair, `discord-bot/test` with a matching
 * applicationId and no missing intents) and the save → 4d → join → 4e → Done;
 * a resume at 4d; Finish later lands on Admin → Discord. The 4c values are
 * fake fixtures — every call that would carry them is answered here.
 */
import type { Page, Route } from '@playwright/test';
import { test, expect } from './base';

const WIZARD = '/admin/setup';
const INVITE = 'https://discord.com/oauth2/authorize?client_id=1290017734588641280&scope=bot';
const BOT = /\/admin\/settings\/discord-bot$/;
const APP_ID = '1290017734588641280';
const KEYS = { appId: APP_ID, secret: 'smoke-fake-client-secret-0000', token: 'smoke.fake.bottoken' };

interface Fake { saved: 'none' | 'keys' | 'joined'; joined: boolean; writes: string[]; pairBodies?: unknown[] }

function corsHeaders(route: Route): Record<string, string> {
    return { 'access-control-allow-origin': route.request().headers()['origin'] ?? '*', 'access-control-allow-credentials': 'true' };
}

/**
 * The request path without the API base: fleet envs serve the API under
 * `/api` (allinone `VITE_API_URL=/api`), GitHub CI at the origin root.
 */
function apiPath(url: string): string {
    return new URL(url).pathname.replace(/^\/api(?=\/)/, '');
}

/** Fulfil `re` with `body`; non-GET calls are logged to `fake.writes`. `writesOnly` lets GETs reach the server. */
async function answer(page: Page, re: RegExp, body: (route: Route) => unknown, fake?: Fake, writesOnly = false): Promise<void> {
    await page.route((url) => re.test(url.pathname), async (route) => {
        const method = route.request().method();
        if (method === 'OPTIONS' || (writesOnly && method === 'GET')) { await route.continue(); return; }
        if (method !== 'GET') fake?.writes.push(`${method} ${apiPath(route.request().url())}`);
        await route.fulfill({ status: 200, headers: corsHeaders(route), json: body(route) });
    });
}

function setupSteps(f: Fake) {
    const keys = f.saved !== 'none';
    const joined = f.saved === 'joined' || f.joined;
    return { steps: [
        { key: 'oauth', completed: keys }, { key: 'bot-token', completed: keys },
        { key: 'bot-connected', completed: joined }, { key: 'default-channel', completed: false },
    ] };
}

function botStatus(f: Fake) {
    return f.saved === 'joined' || f.joined
        ? { configured: true, connected: true, guildName: 'Smoke Raiders', memberCount: 12, guildCount: 1 }
        : { configured: f.saved !== 'none', connected: false };
}

/** 4c: the live pair + token checks and the two saves; the bot save marks the keys saved. */
async function stubKeys(page: Page, f: Fake): Promise<void> {
    await answer(page, /\/admin\/settings\/oauth\/test$/, (route) => {
        f.pairBodies?.push(route.request().postDataJSON());
        return { success: true, message: 'Discord accepted the ID and secret.' };
    }, f);
    await answer(page, /\/admin\/settings\/discord-bot\/test$/, () => ({ success: true, message: 'Token works.', applicationId: APP_ID, missingIntents: [] }), f);
    await answer(page, /\/admin\/settings\/oauth$/, () => {
        if (f.saved === 'none') f.saved = 'keys';
        return { success: true, message: 'Saved.' };
    }, f, true);
}

async function stubDiscord(page: Page, f: Fake): Promise<void> {
    // Context-wide so the Open-invite popup (a new page) is stubbed too.
    await page.context().route('https://discord.com/**', (route) => route.fulfill({ status: 200, body: 'stub' }));
    await answer(page, /\/admin\/onboarding\/status$/, () => ({ completed: false, currentStep: 2, steps: { secureAccount: true, communityIdentity: true, connectPlugins: false } }));
    await answer(page, /\/admin\/onboarding\/(step|complete)$/, () => ({ success: true, step: 3 }), f);
    await answer(page, /\/admin\/settings\/discord-bot\/setup-status$/, () => setupSteps(f));
    await answer(page, BOT, (route) => (route.request().method() === 'PUT'
        ? { success: true, message: 'Saved.' }
        : botStatus(f)), f);
    await stubKeys(page, f);
    await answer(page, /\/discord-bot\/invite-url$/, () => ({ url: INVITE, permissions: ['View Channels'], clientId: '1290017734588641280' }));
    await answer(page, /\/discord-bot\/permissions$/, () => ({ allGranted: true, permissions: [{ name: 'View Channels', granted: true }] }));
    await answer(page, /\/discord-bot\/channels$/, () => [{ id: 'smoke-c1', name: 'general' }, { id: 'smoke-c2', name: 'raid-signups' }]);
    await answer(page, /\/discord-bot\/channel$/, () => ({ channelId: null, success: true }), f);
}

async function openWizard(page: Page, f: Fake): Promise<void> {
    await stubDiscord(page, f);
    await page.goto(WIZARD);
    await expect(page.getByTestId('discord-setup-step')).toBeVisible({ timeout: 15_000 });
}

const title = (page: Page) => page.locator('#discord-substep-title');

async function fillKeys(page: Page): Promise<void> {
    await page.getByLabel('Application ID', { exact: true }).fill(KEYS.appId);
    await page.getByLabel('Client Secret', { exact: true }).fill(KEYS.secret);
    await page.getByLabel('Bot token', { exact: true }).fill(KEYS.token);
}

/** 4d → Open invite → the bot joins → 4e → pick a channel → Continue → wizard moves on. */
async function inviteThroughDone(page: Page, fake: Fake): Promise<void> {
    await expect(title(page)).toHaveText('Invite your bot to your server');
    const next = page.getByRole('button', { name: 'Continue', exact: true });
    await expect(next).toBeDisabled();
    const popup = page.context().waitForEvent('page');
    await page.getByRole('link', { name: 'Open invite' }).click();
    await (await popup).close();
    await expect(page.getByTestId('bot-join-status')).toHaveAttribute('data-state', 'waiting');
    fake.joined = true;
    await expect(page.getByTestId('bot-join-status')).toHaveAttribute('data-state', 'joined', { timeout: 15_000 });
    await expect(page.getByTestId('bot-join-status')).toContainText('Your bot joined Smoke Raiders.');
    await next.click();
    await expect(title(page)).toHaveText('Your bot is in Smoke Raiders');
    await page.getByTestId('default-channel-select').selectOption('smoke-c2');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByTestId('discord-setup-step')).toBeHidden({ timeout: 15_000 });
    expect(fake.writes).toContain('PUT /admin/settings/discord-bot/channel');
    expect(fake.writes).toContain('PATCH /admin/onboarding/step');
}

test.describe('Setup wizard — Discord step (ROK-1703)', () => {
    test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

    test('nothing saved: 4a → 4b → 4c, keys checked live and saved, then 4d → 4e → Done', async ({ page }) => {
        const fake: Fake = { saved: 'none', joined: false, writes: [], pairBodies: [] };
        await openWizard(page, fake);
        await expect(page.getByText('Step 1 of 5')).toBeVisible();
        await page.getByRole('button', { name: "I've created it" }).click();
        await expect(title(page)).toHaveText('Add your sign-in links');
        await page.getByRole('button', { name: 'Both links added' }).click();
        await expect(page.getByText('Step 3 of 5')).toBeVisible();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(title(page)).toHaveText('Add your sign-in links');
        await page.getByRole('button', { name: 'Both links added' }).click();
        await expect(title(page)).toHaveText('Paste your keys and bot token');
        const save = page.getByRole('button', { name: 'Continue', exact: true });
        await expect(save).toBeDisabled();
        await fillKeys(page);
        await expect(page.getByText('Discord accepted the ID and secret together.')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('Token works. Your bot can sign in to Discord.')).toBeVisible({ timeout: 10_000 });
        expect(fake.pairBodies).toContainEqual({ clientId: KEYS.appId, clientSecret: KEYS.secret });
        await expect(save).toBeEnabled();
        await save.click();
        await inviteThroughDone(page, fake);
        expect(fake.writes).toContain('PUT /admin/settings/oauth');
        expect(fake.writes).toContain('PUT /admin/settings/discord-bot');
    });

    test('keys saved: resumes at 4d, waits for the join, then 4e → Done', async ({ page }) => {
        const fake: Fake = { saved: 'keys', joined: false, writes: [] };
        await openWizard(page, fake);
        await inviteThroughDone(page, fake);
    });

    test('bot joined: Finish later completes setup and opens Admin → Discord', async ({ page }) => {
        const fake: Fake = { saved: 'joined', joined: true, writes: [] };
        await openWizard(page, fake);
        await expect(title(page)).toHaveText('Your bot is in Smoke Raiders');
        await page.getByRole('button', { name: 'Finish later' }).click();
        await expect(page).toHaveURL(/\/admin\/settings\/discord/, { timeout: 15_000 });
        expect(fake.writes).toContain('POST /admin/onboarding/complete');
    });
});
