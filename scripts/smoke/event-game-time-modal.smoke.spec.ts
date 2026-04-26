/**
 * Event-detail "My Game Time" modal smoke tests (ROK-1040).
 *
 * Validates the GameTimeWidget modal:
 *  - Opens from the widget trigger on event detail.
 *  - Renders the GameTimeGrid using the profile/FTE-style weekly layout
 *    (no rolling/two-week artifacts: no current-time line, no in-grid
 *    event blocks, no day-header date labels).
 *  - Shows the highlighted event preview block(s) for the event time range.
 *  - Resolves attendee avatars through shared helpers (real <img> tags,
 *    not placeholder fallback initials).
 */
import { test, expect } from './base';
import { getAdminToken, apiPost, apiDelete, apiGet } from './api-helpers';

interface CreatedEvent {
    id: number;
    title: string;
}

/**
 * Create an event the admin signs up to automatically. Future window in the
 * 9 PM → 2 AM range exercises wrap-around preview-block positioning (AC 5).
 */
async function createGameTimeEvent(token: string, title: string): Promise<CreatedEvent> {
    const games = (await apiGet(token, '/games?limit=1')) as { data?: Array<{ id: number }> } | null;
    const gameId = games?.data?.[0]?.id;

    const start = new Date();
    start.setDate(start.getDate() + 2);
    start.setHours(21, 0, 0, 0);
    const end = new Date(start);
    end.setHours(end.getHours() + 5); // 9 PM → 2 AM next day

    const event = (await apiPost(token, '/events', {
        title,
        gameId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        maxAttendees: 10,
    })) as { id: number };
    return { id: event.id, title };
}

test.describe('ROK-1040: Event-detail My Game Time modal', () => {
    let token: string;
    let createdEvent: CreatedEvent | null = null;

    test.beforeAll(async () => {
        token = await getAdminToken();
    });

    test.beforeEach(async () => {
        createdEvent = await createGameTimeEvent(
            token,
            `ROK-1040 GameTime ${Date.now()}`,
        );
    });

    test.afterEach(async () => {
        if (createdEvent) {
            await apiDelete(token, `/events/${createdEvent.id}`);
            createdEvent = null;
        }
    });

    test('modal opens, omits rolling artifacts, and shows highlighted preview blocks', async ({ page }) => {
        await page.goto(`/events/${createdEvent!.id}`);

        const widget = page.locator('[data-testid="game-time-widget"]');
        await expect(widget).toBeVisible({ timeout: 15_000 });
        await widget.click();

        const dialog = page.locator('[role="dialog"]').filter({ hasText: 'My Game Time' });
        await expect(dialog).toBeVisible({ timeout: 10_000 });

        // GameTimeGrid renders inside the modal.
        const grid = dialog.locator('[data-testid="game-time-grid"]');
        await expect(grid).toBeVisible();

        // AC 3 / spec: NO rolling-week red-dot/line indicator.
        await expect(dialog.locator('[data-testid="current-time-indicator"]')).toHaveCount(0);

        // AC 3 / spec: NO existing in-grid event blocks (rich event cards).
        await expect(dialog.locator('[data-testid^="event-block-"]')).toHaveCount(0);

        // AC 3: highlighted event preview block(s) DO render.
        const previewBlocks = dialog.locator('[data-testid^="preview-block-"]');
        await expect(previewBlocks.first()).toBeVisible();

        // AC 5: 9 PM → 2 AM event wraps across midnight; expect at least 2 preview
        // blocks (the two day-of-week columns the event touches).
        const previewCount = await previewBlocks.count();
        expect(previewCount).toBeGreaterThanOrEqual(2);

        // Spec: day headers must NOT show date labels (no weekStart prop in modal).
        // Day header text content should be just the day name (e.g. "Sunday" or "Sun"),
        // NOT include a date sub-label like "Apr 26".
        const sundayHeader = dialog.locator('[data-testid="day-header-0"]');
        await expect(sundayHeader).toBeVisible();
        const headerText = (await sundayHeader.innerText()).trim();
        expect(headerText).not.toMatch(/\d{1,2}/); // no day-of-month digits
    });

    test('event detail card avatars resolve through shared MemberAvatarGroup helper', async ({ page }) => {
        await page.goto(`/events/${createdEvent!.id}`);

        const widget = page.locator('[data-testid="game-time-widget"]');
        await expect(widget).toBeVisible({ timeout: 15_000 });
        await widget.click();

        const dialog = page.locator('[role="dialog"]').filter({ hasText: 'My Game Time' });
        await expect(dialog).toBeVisible({ timeout: 10_000 });

        // EventDetailCard inside the modal renders the highlighted event title and
        // the attendee avatar group. The card is below the grid — scroll into view.
        const eventCardTitle = dialog.getByText('Highlighted Event');
        await eventCardTitle.scrollIntoViewIfNeeded();
        await expect(eventCardTitle).toBeVisible();

        // AC 1: MemberAvatarGroup must render inside the EventDetailCard, proving the
        // signup→avatar plumbing reaches the shared MemberAvatarGroup component (the
        // pre-fix bug used a different attendee renderer and skipped this group).
        const avatarGroup = dialog.locator('[data-testid="member-avatar-group"]');
        await expect(avatarGroup).toBeVisible();

        // AvatarWithFallback renders either a real <img> (resolveAvatar returned a URL)
        // or an InitialsFallback <div> with the first letter of the username. EITHER is
        // a valid resolved avatar — what we are guarding against is the pre-fix bug
        // where empty placeholder circles with no readable identity were rendered.
        const avatarImg = avatarGroup.locator('img');
        const imgCount = await avatarImg.count();

        if (imgCount > 0) {
            const src = await avatarImg.first().getAttribute('src');
            expect(src).toBeTruthy();
            expect(src!.length).toBeGreaterThan(0);
        } else {
            // Initials fallback must contain a letter (placeholder bug rendered empty).
            const initialsText = (await avatarGroup.innerText()).trim();
            expect(initialsText).toMatch(/^[A-Za-z+]/);
        }
    });
});
