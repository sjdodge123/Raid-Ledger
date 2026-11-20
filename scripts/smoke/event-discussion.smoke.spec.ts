/**
 * Event discussion smoke (ROK-2226) — desktop AND mobile.
 *
 * Every test seeds this caller's tagged community-hubs fixture on the tag's own
 * disabled game (`seedCommunityHubs … { dedicatedGame: true }`; the tag is
 * unique per spec × project × worker, so parallel projects never share a hub),
 * then `POST /admin/test/hubs/:id/event-discussion/seed`:
 *   - an OPEN event tagged to the crew hub — thread with 3 replies; crew
 *     member-1 ("member") and a tag-keyed non-member ("PUG") signed up;
 *     crew member-2 ("reader") is a member who is NOT signed up;
 *   - a LOCKED event (ended 27 h ago — writes closed 24 h after the end).
 *
 *  1. AC13 member: the card shows the replies and links to the HUB thread;
 *     posting there shows the reply back on the event page card.
 *  2. PUG: the card CTA opens the `?discussion=1` panel; the reply posts there.
 *  3. Reader: the panel shows the sign-up note and no composer.
 *  4. AC14 locked: card and panel show the lock reason and no composer.
 *
 * Every write is confirmed by polling the API before the UI is trusted
 * (memory `feedback_smoke_polling_for_async_writes`).
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPost, getAdminToken } from './api-helpers';
import { hubSeedTag, seedCommunityHubs } from './hub-seed';
import { signInOnboardedMember } from './browser-session';
import { editorTextbox } from './hub-post-editor';

const SLUG = 'event-discussion';
/** ROK-2272: event threads close 1 h after the end (was 24 h). */
const LOCK_COPY = 'Closed 1 h after the event ended';
const SIGN_UP_COPY = 'Sign up to join the discussion.';
/** The fixture's open-thread replies (`OPEN_REPLY_BODIES`). */
const SEEDED_REPLIES = ['Bring flasks and food buffs.', 'I can tank if we are short.', 'Happy to fill a healer spot.'];

interface DiscussionSeed {
    guildId: number;
    eventId: number;
    threadId: number;
    lockedEventId: number;
    lockedThreadId: number;
    memberUserId: number;
    readerUserId: number;
    pugUserId: number;
}

interface ThreadReplies { replies: Array<{ body: string }> }

type Viewer = 'member' | 'reader' | 'pug';

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[event-discussion] missing ${label}`);
    return value;
}

function isSeed(v: unknown): v is DiscussionSeed {
    const s = v as Partial<DiscussionSeed> | null;
    return typeof s?.eventId === 'number' && typeof s.threadId === 'number' && typeof s.lockedEventId === 'number'
        && typeof s.pugUserId === 'number' && typeof s.guildId === 'number';
}

/** Seed the crew hub + the discussion fixture; returns the ids. */
async function seedDiscussion(testInfo: TestInfo): Promise<DiscussionSeed> {
    const admin = await getAdminToken();
    const hubs = (await seedCommunityHubs(admin, testInfo, 'event-discussion', { dedicatedGame: true })) as
        { hubIds?: { crew?: number }; memberUserIds?: number[] } | null;
    const crew = must(hubs?.hubIds?.crew, `crew hub in ${JSON.stringify(hubs)}`);
    const memberUserId = must(hubs?.memberUserIds?.[1], 'crew member-1');
    const readerUserId = must(hubs?.memberUserIds?.[2], 'crew member-2');
    const body = { memberUserId, readerUserId, tag: hubSeedTag(SLUG, testInfo) };
    const seed: unknown = await apiPost(admin, `/admin/test/hubs/${crew}/event-discussion/seed`, body);
    if (!isSeed(seed)) throw new Error(`[event-discussion] seed: ${JSON.stringify(seed)}`);
    return seed;
}

/** Sign `viewer` in through a magic session; returns their JWT. */
async function signIn(page: Page, seed: DiscussionSeed, viewer: Viewer): Promise<string> {
    const ids: Record<Viewer, number> = { member: seed.memberUserId, reader: seed.readerUserId, pug: seed.pugUserId };
    return signInOnboardedMember(page, ids[viewer]);
}

async function threadReplies(jwt: string, eventId: number): Promise<string[]> {
    const body = (await apiGet(jwt, `/events/${eventId}/discussion/thread`)) as ThreadReplies | null;
    return body?.replies.map((r) => r.body) ?? [];
}

/** Open the event page and wait for the discussion card. */
async function openCard(page: Page, eventId: number): Promise<Locator> {
    await page.goto(`/events/${eventId}`);
    const card = page.getByTestId('event-discussion-card');
    await expect(card, 'the event page shows the Discussion card').toBeVisible({ timeout: 20_000 });
    return card;
}

/** Open `/events/:id?discussion=1` and wait for the panel's thread heading. */
async function openPanel(page: Page, eventId: number): Promise<Locator> {
    await page.goto(`/events/${eventId}?discussion=1`);
    const panel = page.getByTestId('event-discussion-panel');
    await expect(panel.getByTestId('forum-thread-heading'), '?discussion=1 opens the thread panel').toBeVisible({ timeout: 20_000 });
    return panel;
}

/** Type `text` into the reply editor, submit, and confirm the API stored it. */
async function postReply(page: Page, jwt: string, eventId: number, text: string): Promise<void> {
    const box = await editorTextbox(page, page.getByTestId('forum-reply-input'));
    await box.click();
    await page.keyboard.type(text);
    await expect(box, 'the reply editor holds the typed text').toContainText(text);
    await page.getByTestId('forum-reply-submit').click();
    await expect
        .poll(() => threadReplies(jwt, eventId), { message: 'the API stored the reply', timeout: 15_000 })
        .toContain(text);
}

test.describe('event discussion', () => {
    test('AC13: a signed-up hub member sees the replies, goes to the hub thread, and the reply shows on the card', async ({ page, world }, testInfo) => {
        const seed = await seedDiscussion(testInfo);
        const jwt = await signIn(page, seed, 'member');
        const card = await openCard(page, seed.eventId);
        await expect(card.getByTestId('event-discussion-reply'), 'the card shows the 3 seeded replies').toHaveCount(3);
        for (const body of SEEDED_REPLIES) await expect(card, `the card shows "${body}"`).toContainText(body);

        const cta = card.getByTestId('event-discussion-cta');
        await expect(cta, 'a signed-up member gets "Join the discussion"').toHaveText(/Join the discussion/);
        await expect(cta, 'a hub member is linked to the hub thread').toHaveAttribute('href', `/hubs/${seed.guildId}?thread=${seed.threadId}#forum`);
        await cta.click();
        await expect(page.getByTestId('hub-forum-thread'), 'the CTA lands on the hub thread').toBeVisible({ timeout: 20_000 });

        const reply = `Member reply ${world.uid('evdisc')}`;
        await postReply(page, jwt, seed.eventId, reply);
        const back = await openCard(page, seed.eventId);
        await expect(back.getByTestId('event-discussion-reply').filter({ hasText: reply }), 'the new reply shows on the card').toBeVisible({ timeout: 15_000 });
    });

    test('a signed-up non-member opens the event-page panel from the card and replies there', async ({ page, world }, testInfo) => {
        const seed = await seedDiscussion(testInfo);
        const jwt = await signIn(page, seed, 'pug');
        const card = await openCard(page, seed.eventId);
        const cta = card.getByTestId('event-discussion-cta');
        await expect(cta, 'a non-member is linked to the event-page panel').toHaveAttribute('href', `/events/${seed.eventId}?discussion=1`);
        await cta.click();
        const panel = page.getByTestId('event-discussion-panel');
        await expect(panel.getByTestId('forum-thread-heading'), 'the CTA opens the panel on the event page').toBeVisible({ timeout: 20_000 });
        await expect(panel.getByTestId('forum-reply-composer'), 'a signed-up viewer gets the composer').toBeVisible();

        const reply = `PUG reply ${world.uid('evdisc')}`;
        await postReply(page, jwt, seed.eventId, reply);
        await expect(panel.getByTestId('forum-reply').filter({ hasText: reply }), 'the reply shows in the panel').toBeVisible({ timeout: 15_000 });
    });

    test('a hub member who is not signed up reads the thread with the sign-up note and no composer', async ({ page }, testInfo) => {
        const seed = await seedDiscussion(testInfo);
        const jwt = await signIn(page, seed, 'reader');
        await expect
            .poll(async () => ((await apiGet(jwt, `/events/${seed.eventId}/discussion`)) as { can?: { reply?: boolean } } | null)?.can?.reply,
                { message: 'the API says the reader cannot reply', timeout: 15_000 })
            .toBe(false);
        const card = await openCard(page, seed.eventId);
        await expect(card.getByTestId('event-discussion-signup-note'), 'the card shows the sign-up note').toHaveText(SIGN_UP_COPY);

        const panel = await openPanel(page, seed.eventId);
        await expect(panel.getByTestId('forum-reply').first(), 'the reader sees the replies').toBeVisible({ timeout: 15_000 });
        await expect(panel.getByTestId('event-discussion-signup-note'), 'the panel shows the sign-up note').toHaveText(SIGN_UP_COPY);
        await expect(panel.getByTestId('forum-reply-composer'), 'a reader gets no composer').toHaveCount(0);
    });

    test('AC14: an event that ended over 24 h ago is read-only with the lock reason and no composer', async ({ page }, testInfo) => {
        const seed = await seedDiscussion(testInfo);
        await signIn(page, seed, 'member');
        const card = await openCard(page, seed.lockedEventId);
        await expect(card.getByTestId('forum-lock-bar'), 'the card shows the lock reason').toContainText(LOCK_COPY);
        await expect(card.getByTestId('event-discussion-cta'), 'a locked card offers reading, not joining').toHaveText(/Read the full thread/);

        const panel = await openPanel(page, seed.lockedEventId);
        await expect(panel.getByTestId('forum-lock-bar'), 'the panel shows the lock reason').toContainText(LOCK_COPY);
        await expect(panel.getByTestId('forum-reply-composer'), 'a locked thread has no composer').toHaveCount(0);
        await expect(panel.getByTestId('event-discussion-signup-note'), 'a locked thread has no sign-up note').toHaveCount(0);
    });
});
