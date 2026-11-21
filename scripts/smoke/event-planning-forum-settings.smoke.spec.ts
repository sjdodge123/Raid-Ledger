/**
 * ROK-2272 S5b — Admin → Discord Overview "Event planning forum" card,
 * desktop AND mobile, as the smoke admin (global-setup storage state).
 *
 * CI has no real Discord, so `GET/PUT /admin/discord/event-planning-forum`
 * are stubbed with `page.route` (the hub-forum-discord settings spec's
 * approach): the subject is the card (picker vs read-only line, the save,
 * the pick surviving a reload). The candidate check itself is covered by the
 * api integration spec (`event-planning-forum.admin.integration.spec.ts`).
 */
import type { Page, Route } from '@playwright/test';
import type { EventPlanningForumCandidate, EventPlanningForumSettingsDto } from '@raid-ledger/contract';
import { test, expect } from './base';

const SHARED: EventPlanningForumCandidate = { channelId: '323456789012345678', name: 'event-planning', managed: true };
const RAIDS: EventPlanningForumCandidate = { channelId: '423456789012345678', name: 'raid-forum', managed: false };
const LOOT: EventPlanningForumCandidate = { channelId: '523456789012345678', name: 'loot-forum', managed: false };
const OVERVIEW = '/admin/settings/discord';

interface Stub { puts: unknown[]; picked: string | null }

/** The api resolver's rules (§3.2): one forum ⇒ it; a valid pick ⇒ it; else the single bot-made #event-planning; else ambiguous. */
function settings(candidates: EventPlanningForumCandidate[], picked: string | null): EventPlanningForumSettingsDto {
    const pick = candidates.find((c) => c.channelId === picked);
    const managed = candidates.filter((c) => c.managed && c.name === 'event-planning');
    const auto = managed.length === 1 ? managed[0] : undefined;
    const resolved = candidates.length <= 1 ? candidates[0] : (pick ?? auto);
    const ambiguous = candidates.length >= 2 && !resolved;
    return { channelId: picked, candidates, resolvedChannelId: resolved?.channelId ?? null, ...(ambiguous ? { warning: 'ambiguous' } : {}) };
}

function pickedFrom(body: unknown): string | null {
    if (typeof body !== 'object' || body === null || !('channelId' in body)) return null;
    return typeof body.channelId === 'string' ? body.channelId : null;
}

/** Serve the card's route from in-memory state that a PUT updates (so a reload reads it back). */
async function stubPlanningForum(page: Page, candidates: EventPlanningForumCandidate[]): Promise<Stub> {
    const stub: Stub = { puts: [], picked: null };
    await page.route((url) => url.pathname.endsWith('/admin/discord/event-planning-forum'), async (route: Route) => {
        if (route.request().method() === 'PUT') {
            const body: unknown = route.request().postDataJSON();
            stub.puts.push(body);
            stub.picked = pickedFrom(body);
        }
        await route.fulfill({ json: settings(candidates, stub.picked) });
    });
    return stub;
}

async function openCard(page: Page) {
    await page.goto(OVERVIEW);
    const card = page.getByTestId('event-planning-forum-card');
    await card.scrollIntoViewIfNeeded({ timeout: 20_000 });
    await expect(card.getByRole('heading', { name: 'Event planning forum' })).toBeVisible();
    return card;
}

test.describe('Admin Discord — Event planning forum (ROK-2272)', () => {
    test('two bound forums, none bot-made: the admin picks one and it survives a reload', async ({ page }) => {
        const stub = await stubPlanningForum(page, [RAIDS, LOOT]);
        let card = await openCard(page);
        const select = card.getByRole('combobox', { name: 'Discord forum' });
        await expect(select).toHaveValue('');
        await expect(card.getByTestId('event-planning-forum-resolved')).toContainText('Not set');

        await select.selectOption(RAIDS.channelId);
        await expect.poll(() => stub.puts).toEqual([{ channelId: RAIDS.channelId }]);
        await expect(card.getByTestId('event-planning-forum-resolved')).toContainText('Posting to #raid-forum');

        await page.reload();
        card = await openCard(page);
        await expect(card.getByRole('combobox', { name: 'Discord forum' })).toHaveValue(RAIDS.channelId);
        await expect(card.getByTestId('event-planning-forum-resolved')).toContainText('Posting to #raid-forum');
    });

    test('one bound forum: a read-only "Using #name" line, no picker', async ({ page }) => {
        await stubPlanningForum(page, [SHARED]);
        const card = await openCard(page);
        await expect(card.getByTestId('event-planning-forum-using')).toHaveText('Using #event-planning');
        await expect(card.getByRole('combobox', { name: 'Discord forum' })).toHaveCount(0);
    });

    test('no bound forum: says to bind a hub forum first', async ({ page }) => {
        await stubPlanningForum(page, []);
        const card = await openCard(page);
        await expect(card.getByTestId('event-planning-forum-none')).toContainText('Bind a hub forum first');
        await expect(card.getByRole('combobox', { name: 'Discord forum' })).toHaveCount(0);
    });
});
