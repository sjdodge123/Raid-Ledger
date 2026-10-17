/**
 * ROK-1655 AC3 (ROK-1649 ruling 5) — closing the Cancel Event modal with a
 * typed reason asks first.
 *
 * `cancel-event-modal.tsx` treats the reason as a draft: Escape, the backdrop,
 * × and its own Keep Event button run `useDirtyCloseGuard`, which shows the
 * shared "Discard your changes?" confirm. Keep editing leaves the reason in
 * place; Discard closes the modal WITHOUT cancelling the event. A clean modal
 * closes on Escape with no confirm.
 *
 * This is the Playwright half of AC3 for the form that replaced the deleted
 * pug-form-modal; the Vitest half is `__tests__/cancel-event-modal.test.tsx`.
 * Nothing here presses the footer's Cancel Event, so the fixture event is
 * never cancelled — the API read at the end proves it.
 *
 * Opening the modal: below Tailwind's `sm` (640px) the event topbar hides
 * Cancel Event behind "More actions" (ROK-886). That is the `mobile` project
 * only — the `tablet` project (810px) is phone-layout by `isPhoneLayout` but
 * still above `sm`, so it gets the inline button like desktop.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { isMobile } from './helpers';
import { getAdminToken, apiGet, apiPost, apiDelete } from './api-helpers';

const CONFIRM_TITLE = 'Discard your changes?';
const REASON = 'Not enough tanks this week';

let token: string;
let eventId: number | null = null;

test.beforeAll(async ({}, testInfo) => {
    token = await getAdminToken();
    const start = new Date(Date.now() + 2 * 86_400_000);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    const event = (await apiPost(token, '/events', {
        title: `smoke-cancel-dirty-close-${testInfo.project.name}-${Date.now()}`,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        maxAttendees: 10,
    })) as { id?: number };
    eventId = event.id ?? null; // claimed before any assertion so afterAll can clean it up
    if (eventId === null) throw new Error(`POST /events returned no id: ${JSON.stringify(event)}`);
});

test.afterAll(async () => {
    if (eventId !== null) await apiDelete(token, `/events/${eventId}`);
    eventId = null;
});

/** Open the event and its Cancel Event modal; returns the dialog. */
async function openCancelModal(page: Page, testInfo: TestInfo): Promise<Locator> {
    await page.goto(`/events/${eventId}`);
    if (isMobile(testInfo)) {
        const more = page.getByRole('button', { name: 'More actions' });
        await expect(more).toBeVisible({ timeout: 15_000 });
        await more.click();
    }
    const trigger = page.getByRole('button', { name: 'Cancel Event', exact: true });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Cancel Event', exact: true });
    await expect(dialog).toBeVisible();
    return dialog;
}

/** The API still reports the fixture event live, with no reason stored. */
async function expectNotCancelled(): Promise<void> {
    const event = (await apiGet(token, `/events/${eventId}`)) as
        { cancelledAt?: string | null; cancellationReason?: string | null } | null;
    expect(event, `GET /events/${eventId} failed`).not.toBeNull();
    expect(event?.cancelledAt ?? null, 'Discard must not cancel the event').toBeNull();
    expect(event?.cancellationReason ?? null, 'the discarded reason must not be saved').toBeNull();
}

test.describe('Cancel Event modal — dirty close asks first (ROK-1655 AC3)', () => {
    test('a typed reason: Escape asks, Keep editing keeps it, Keep Event + Discard closes without cancelling', async ({ page }, testInfo) => {
        const dialog = await openCancelModal(page, testInfo);
        const reason = dialog.getByLabel('Reason (optional)');
        const confirm = page.getByRole('dialog', { name: CONFIRM_TITLE });

        await reason.fill(REASON);
        await expect(reason).toHaveValue(REASON);

        await page.keyboard.press('Escape');
        await expect(confirm, 'Escape with a typed reason should ask before closing').toBeVisible();

        await confirm.getByRole('button', { name: 'Keep editing' }).click();
        await expect(confirm).toBeHidden();
        await expect(dialog, 'Keep editing should leave the modal open').toBeVisible();
        await expect(reason, 'Keep editing should leave the reason intact').toHaveValue(REASON);

        await dialog.getByRole('button', { name: 'Keep Event', exact: true }).click();
        await expect(confirm, 'Keep Event with a typed reason should ask before closing').toBeVisible();
        await confirm.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(confirm).toBeHidden();
        await expect(dialog, 'Discard should close the modal').toBeHidden();
        await expectNotCancelled();
    });

    test('a clean modal closes on Escape with no confirm', async ({ page }, testInfo) => {
        const dialog = await openCancelModal(page, testInfo);
        await expect(dialog.getByLabel('Reason (optional)')).toHaveValue('');

        await page.keyboard.press('Escape');
        await expect(dialog, 'a clean modal should close straight away').toBeHidden();
        await expect(page.getByRole('dialog', { name: CONFIRM_TITLE })).toBeHidden();
    });
});
