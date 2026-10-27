/**
 * First-run wizard Calendar step (ROK-2022) — desktop AND mobile projects.
 *
 * Each test runs as a member seeded for THIS run (desktop + mobile share one DB,
 * and the admin's connections are touched by other calendar specs). The member is
 * onboarded by `signInOnboardedMember`, so the wizard is entered with `?rerun=1`,
 * or with `?resume=calendar`, which the Google OAuth callback appends and which
 * also allows a rerun. No live Google: the resume URLs simulate the callback.
 *
 * The calendar-sync kill switch is GLOBAL, so it is only ever turned ON (as in
 * profile-calendars.smoke.spec.ts); the switch-off state is covered by unit tests
 * and the fleet test plan.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, apiPut, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

const SETTINGS = '/admin/settings/calendar-sync';
const STEP_HEADING = 'Connect Your Calendar';
const CONNECTION_HEADING = 'How fast is your connection?';

let token: string;

test.beforeAll(async () => {
    token = await getAdminToken();
    await apiPut(token, SETTINGS, { enabled: true });
});

async function seedMember(): Promise<number> {
    const user = (await apiPost(token, '/admin/test/seed-non-guild-user', { quietDms: true })) as { userId?: number };
    if (typeof user.userId !== 'number') throw new Error(`seed-non-guild-user: ${JSON.stringify(user)}`);
    return user.userId;
}

async function seedConnection(userId: number, project: string): Promise<void> {
    const conn = (await apiPost(token, '/admin/test/calendar/seed-connection', {
        userId, accountLabel: `wizard-${project}-${Date.now()}@example.com`,
    })) as { id?: number };
    if (typeof conn.id !== 'number') throw new Error(`seed-connection: ${JSON.stringify(conn)}`);
}

async function removeMember(userId: number): Promise<void> {
    await apiDelete(token, `/users/${userId}`).catch(() => undefined);
}

async function openWizard(page: Page, url: string): Promise<Locator> {
    await page.goto(url);
    const dialog = page.getByRole('dialog', { name: 'Onboarding wizard' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    return dialog;
}

/**
 * The dialog's button texts, in order, once the Game Time crumb has rendered. A
 * collapsed crumb carries its label twice (in-flow + hover), so match by `includes`.
 */
async function crumbLabels(dialog: Locator): Promise<string[]> {
    await expect(dialog.getByRole('button', { name: 'Game Time' })).toBeVisible({ timeout: 10_000 });
    return dialog.getByRole('button').allTextContents();
}

function crumbAt(labels: string[], needle: string): number {
    return labels.findIndex((t) => t.includes(needle));
}

test('no connection: Calendar step sits after Game Time, shows both providers, Skip → Connection', async ({ page }) => {
    const userId = await seedMember();
    try {
        await signInOnboardedMember(page, userId);
        const dialog = await openWizard(page, '/onboarding?rerun=1');
        const labels = await crumbLabels(dialog);
        expect(crumbAt(labels, 'Calendar'), `Calendar after Game Time in ${JSON.stringify(labels)}`)
            .toBeGreaterThan(crumbAt(labels, 'Game Time'));
        expect(crumbAt(labels, 'Calendar'), 'Calendar before Connection').toBeLessThan(crumbAt(labels, 'Connection'));

        await dialog.getByRole('button', { name: 'Calendar' }).click();
        await expect(dialog.getByRole('heading', { name: STEP_HEADING })).toBeVisible({ timeout: 10_000 });
        await expect(dialog.getByTestId('calendar-provider-google')).toBeVisible({ timeout: 10_000 });
        await expect(dialog.getByTestId('calendar-provider-apple')).toBeVisible();

        await dialog.getByRole('button', { name: 'Skip', exact: true }).click();
        await expect(dialog.getByRole('heading', { name: CONNECTION_HEADING })).toBeVisible({ timeout: 10_000 });
    } finally {
        await removeMember(userId);
    }
});

test('OAuth error return: ?resume=calendar&error=denied opens ON the step with the banner', async ({ page }) => {
    const userId = await seedMember();
    try {
        await signInOnboardedMember(page, userId);
        const dialog = await openWizard(page, '/onboarding?resume=calendar&error=denied');
        await expect(dialog.getByRole('heading', { name: STEP_HEADING })).toBeVisible({ timeout: 15_000 });
        await expect(dialog.getByTestId('calendar-oauth-error')).toHaveAttribute('data-error-code', 'denied');
        await expect(dialog.getByTestId('calendar-provider-google')).toBeVisible();
        // Both params are stripped once handled, so a reload does not re-seek or re-show the banner.
        await expect(page).toHaveURL(/\/onboarding$/, { timeout: 10_000 });
    } finally {
        await removeMember(userId);
    }
});

test('OAuth success return: ?resume=calendar&connected=google shows the connected card; Next → Connection', async ({ page }, testInfo) => {
    const userId = await seedMember();
    try {
        await seedConnection(userId, testInfo.project.name);
        await signInOnboardedMember(page, userId);
        const dialog = await openWizard(page, '/onboarding?resume=calendar&connected=google');
        await expect(dialog.getByRole('heading', { name: STEP_HEADING })).toBeVisible({ timeout: 15_000 });
        await expect(dialog.getByTestId('calendar-connection-card')).toHaveCount(1, { timeout: 10_000 });
        await expect(dialog.getByTestId('calendar-step-providers')).toHaveCount(0);

        await dialog.getByRole('button', { name: 'Next', exact: true }).click();
        await expect(dialog.getByRole('heading', { name: CONNECTION_HEADING })).toBeVisible({ timeout: 10_000 });
    } finally {
        await removeMember(userId);
    }
});

test('an already-connected user never sees the Calendar step', async ({ page }, testInfo) => {
    const userId = await seedMember();
    try {
        await seedConnection(userId, testInfo.project.name);
        await signInOnboardedMember(page, userId);
        const dialog = await openWizard(page, '/onboarding?rerun=1');
        const labels = await crumbLabels(dialog);
        expect(crumbAt(labels, 'Calendar'), `no Calendar crumb in ${JSON.stringify(labels)}`).toBe(-1);
        expect(crumbAt(labels, 'Connection')).toBeGreaterThan(crumbAt(labels, 'Game Time'));
    } finally {
        await removeMember(userId);
    }
});
