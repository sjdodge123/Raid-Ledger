/**
 * Event discussion signup lines smoke (ROK-2274) — desktop AND mobile.
 *
 * Seeds this caller's tagged community-hubs crew (`dedicatedGame: true`, so
 * each spec × project × worker owns its hub) and the ROK-2226 event-discussion
 * fixture: an open hub event whose thread has 3 replies, crew member-1 and a
 * PUG signed up, crew member-2 ("reader") NOT signed up. Then:
 *   1. a forced signup flush (`flush-signup-pings`, RL half first, bound hub
 *      or not) seeds the thread's line states — no line yet (D4);
 *   2. the reader signs up (`/admin/test/signup`);
 *   3. a second forced flush writes the reader's `signup_line`.
 *
 * The line must render as the muted system row (`forum-signup-line`), never
 * as a normal reply, and must stay out of the event card's preview. The crew
 * officer gets its Delete action; a plain member gets none.
 *
 * Every write is confirmed by polling the API before the UI is trusted
 * (memory `feedback_smoke_polling_for_async_writes`).
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPost, getAdminToken } from './api-helpers';
import { hubSeedTag, seedCommunityHubs } from './hub-seed';
import { signInOnboardedMember } from './browser-session';

const SLUG = 'event-discussion-signup-lines';
/** Seed-tag slug: hubSeedTag caps `<slug>-<project>-wNN` at 32 chars, so the spec name is too long. */
const SEED_SLUG = 'ev-signup-lines';

interface LineSeed {
    guildId: number;
    eventId: number;
    threadId: number;
    officerUserId: number;
    memberUserId: number;
    readerUserId: number;
}

interface ThreadReply {
    id: number;
    kind?: 'reply' | 'signup_line';
    body: string;
    deleted: unknown;
    can: { delete?: boolean };
}

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[${SLUG}] missing ${label}`);
    return value;
}

function num(v: unknown, label: string): number {
    if (typeof v !== 'number') throw new Error(`[${SLUG}] ${label} is not a number: ${JSON.stringify(v)}`);
    return v;
}

/** Force the event's debounced signup flush NOW (RL lines first). */
async function flushLines(admin: string, eventId: number): Promise<void> {
    await apiPost(admin, `/admin/test/hub-forum-discord/events/${eventId}/flush-signup-pings`, {});
}

/** Seed crew + discussion, seed the line states, then sign the reader up and flush again. */
async function seedSignupLine(testInfo: TestInfo): Promise<LineSeed> {
    const admin = await getAdminToken();
    const hubs = (await seedCommunityHubs(admin, testInfo, SEED_SLUG, { dedicatedGame: true })) as
        { hubIds?: { crew?: number }; memberUserIds?: number[] } | null;
    const crew = must(hubs?.hubIds?.crew, `crew hub in ${JSON.stringify(hubs)}`);
    const officerUserId = must(hubs?.memberUserIds?.[0], 'crew officer');
    const memberUserId = must(hubs?.memberUserIds?.[1], 'crew member-1');
    const readerUserId = must(hubs?.memberUserIds?.[2], 'crew member-2');
    const body = { memberUserId, readerUserId, tag: hubSeedTag(SEED_SLUG, testInfo) };
    const seed = (await apiPost(admin, `/admin/test/hubs/${crew}/event-discussion/seed`, body)) as
        { guildId?: unknown; eventId?: unknown; threadId?: unknown } | null;
    const eventId = num(seed?.eventId, 'seed.eventId');
    await flushLines(admin, eventId);
    await apiPost(admin, '/admin/test/signup', { eventId, userId: readerUserId });
    await flushLines(admin, eventId);
    return {
        guildId: num(seed?.guildId, 'seed.guildId'),
        eventId,
        threadId: num(seed?.threadId, 'seed.threadId'),
        officerUserId,
        memberUserId,
        readerUserId,
    };
}

async function threadReplies(jwt: string, eventId: number): Promise<ThreadReply[]> {
    const body = (await apiGet(jwt, `/events/${eventId}/discussion/thread`)) as { replies?: ThreadReply[] } | null;
    return body?.replies ?? [];
}

/** Poll until the thread carries exactly one signup line; returns it. */
async function waitForLine(jwt: string, eventId: number): Promise<ThreadReply> {
    await expect
        .poll(async () => (await threadReplies(jwt, eventId)).filter((r) => r.kind === 'signup_line').length,
            { message: 'the API thread carries the reader\'s signup line (and only it)', timeout: 15_000 })
        .toBe(1);
    const line = (await threadReplies(jwt, eventId)).find((r) => r.kind === 'signup_line');
    return must(line, 'signup line reply');
}

/** Open `/events/:id?discussion=1` and wait for the panel's thread heading. */
async function openPanel(page: Page, eventId: number) {
    await page.goto(`/events/${eventId}?discussion=1`);
    const panel = page.getByTestId('event-discussion-panel');
    await expect(panel.getByTestId('forum-thread-heading'), '?discussion=1 opens the thread panel').toBeVisible({ timeout: 20_000 });
    return panel;
}

test.describe('event discussion signup lines', () => {
    test('a member sees the signup line as a muted system row, not a reply, with no actions', async ({ page }, testInfo) => {
        const seed = await seedSignupLine(testInfo);
        const jwt = await signInOnboardedMember(page, seed.memberUserId);
        const line = await waitForLine(jwt, seed.eventId);
        expect(line.body, 'the line reads "<emoji> <name> signed up…"').toMatch(/signed up/);
        expect(line.can.delete, 'a plain member cannot delete a signup line').toBe(false);

        const panel = await openPanel(page, seed.eventId);
        const row = panel.getByTestId('forum-signup-line');
        await expect(row, 'the panel renders one signup line row').toHaveCount(1, { timeout: 15_000 });
        await expect(row, 'the row is anchored by the line id').toHaveAttribute('id', `forum-reply-${line.id}`);
        await expect(row.getByTestId('forum-signup-line-text'), 'the row shows the line text').toHaveText(line.body);
        await expect(row.getByTestId('forum-signup-line-time'), 'the row shows a timestamp').toBeVisible();
        await expect(panel.getByTestId('forum-reply'), 'the 3 seeded replies still render as replies').toHaveCount(3);
        await expect(panel.getByTestId('forum-reply').filter({ hasText: line.body }), 'the line is not rendered as a reply').toHaveCount(0);
        await expect(row.getByTestId('forum-signup-line-actions'), 'a member gets no line actions').toHaveCount(0);

        await page.goto(`/events/${seed.eventId}`);
        const card = page.getByTestId('event-discussion-card');
        await expect(card, 'the event page shows the Discussion card').toBeVisible({ timeout: 20_000 });
        await expect(card.getByTestId('event-discussion-reply'), 'the card preview keeps the 3 real replies').toHaveCount(3);
        await expect(card, 'the card preview skips the signup line').not.toContainText(line.body);
    });

    test('the crew officer sees the line in the hub thread and can delete it', async ({ page }, testInfo) => {
        const seed = await seedSignupLine(testInfo);
        const jwt = await signInOnboardedMember(page, seed.officerUserId);
        const line = await waitForLine(jwt, seed.eventId);
        expect(line.can.delete, 'an officer may delete a signup line').toBe(true);

        await page.goto(`/hubs/${seed.guildId}?thread=${seed.threadId}#forum`);
        const thread = page.getByTestId('hub-forum-thread');
        await expect(thread, 'the hub thread opens').toBeVisible({ timeout: 20_000 });
        const row = thread.getByTestId('forum-signup-line');
        await expect(row.getByTestId('forum-signup-line-text'), 'the hub thread shows the line').toHaveText(line.body, { timeout: 15_000 });
        await expect(thread.getByTestId('forum-reply').filter({ hasText: line.body }), 'the line is not rendered as a reply').toHaveCount(0);

        await row.getByTestId('forum-signup-line-actions').click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await expect(page.getByText('Delete this signup line?'), 'the line delete confirm opens').toBeVisible();
        await page.getByTestId('forum-delete-confirm').click();
        await expect
            .poll(async () => (await threadReplies(jwt, seed.eventId)).find((r) => r.id === line.id)?.deleted ?? null,
                { message: 'the API marks the signup line moderator-deleted', timeout: 15_000 })
            .toBe('moderator');
        await expect(row.getByTestId('forum-signup-line-actions'), 'a deleted line has no actions').toHaveCount(0, { timeout: 15_000 });
    });
});
