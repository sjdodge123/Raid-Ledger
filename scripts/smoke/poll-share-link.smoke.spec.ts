/**
 * Private game polls shareable by link (ROK-1750) — desktop + mobile.
 *
 *   1. Admin creates a PRIVATE poll through the "Schedule a Game" modal → the
 *      success state shows the share link (no auto-navigate) → Open poll shows
 *      the Private bar.
 *   2. A signed-out visitor on `/p/poll/<token>` sees the preview (game, who
 *      invited them, Open) and a Sign in CTA — never the poll or its members.
 *   3. A second, signed-in member opens the link → is joined → lands on the
 *      canonical poll page → can vote.
 *   4. The creator resets the link → the old link shows the invalid state.
 *
 * The second user is the onboarded `seed-fixture-user` member, signed in by
 * JWT in localStorage (see poll-share-fixtures.ts) — no typed credentials.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { dismissGameTimeCheck } from './helpers';
import { API_BASE, apiDelete, apiGet, apiPatch, getAdminToken, pollForCondition } from './api-helpers';
import { leaderYesToggle } from './scheduling-poll-fixtures';
import {
    openAnonContext, openMemberContext, pollPagePath, seedPrivatePoll, suggestTime, waitForPollReadable,
    type PrivatePoll,
} from './poll-share-fixtures';

const GAME = 'World of Warcraft: Forever';
const INVALID_LINK = 'This link is no longer valid — ask whoever sent it for a new one.';

test.describe.configure({ timeout: 120_000 });

/** Phone layouts unmount the slot list behind the game-time sheet until confirmed (ROK-1617). */
test.beforeAll(async () => {
    await apiPatch(await getAdminToken(), '/users/me/game-time/confirm', {});
});

/** Pick `name` in the modal's game combobox, waiting on the final search response. */
async function pickGame(page: Page, name: string): Promise<void> {
    const input = page.getByTestId('game-search-input');
    const settled = page.waitForResponse((r) => {
        const url = new URL(r.url());
        return url.pathname.endsWith('/games/search') && url.searchParams.get('q') === name && r.ok();
    }, { timeout: 20_000 });
    await input.click();
    await input.pressSequentially(name, { delay: 20 });
    await settled;
    const option = page.getByRole('option', { name, exact: true });
    await expect(option, `the seeded "${name}" should be in the game search results`).toBeVisible({ timeout: 10_000 });
    await option.click();
    await expect(input).toHaveValue(name);
}

test.describe('Private poll share link (ROK-1750)', () => {
    test('creating a private poll shows its share link, then the poll page shows the Private bar', async ({ page }) => {
        const token = await getAdminToken();
        let lineupId: number | null = null;
        try {
            await page.goto('/events');
            await page.getByRole('button', { name: /Schedule a Game/i }).click();
            const modal = page.getByRole('dialog');
            await expect(modal).toBeVisible({ timeout: 10_000 });

            await pickGame(page, GAME);
            await modal.getByRole('radio', { name: /Private — anyone with the link/ }).check();

            const created = page.waitForResponse(
                (r) => new URL(r.url()).pathname.endsWith('/scheduling-polls') && r.request().method() === 'POST',
                { timeout: 20_000 },
            );
            await modal.getByRole('button', { name: 'Create Poll' }).click();
            const res = await created;
            expect(res.status(), 'POST /scheduling-polls').toBe(201);
            const body = (await res.json()) as { id: number; lineupId: number; visibility: string; shareToken: string | null };
            lineupId = body.lineupId;
            expect(body.visibility).toBe('private');
            expect(body.shareToken, 'a private poll is created with a share token').toBeTruthy();

            // Success state: the link, and the modal stays put (no auto-navigate).
            await expect(modal.getByTestId('create-poll-success')).toBeVisible({ timeout: 10_000 });
            await expect(modal.getByRole('textbox', { name: 'Poll share link' }))
                .toHaveValue(new RegExp(`/p/poll/${body.shareToken}$`));
            await expect(page).toHaveURL(/\/events/);

            await modal.getByRole('button', { name: 'Open poll' }).click();
            await expect(page).toHaveURL(new RegExp(`${pollPagePath({ lineupId: body.lineupId, pollId: body.id })}$`));
            await dismissGameTimeCheck(page);
            const bar = page.getByTestId('poll-private-bar');
            await expect(bar).toBeVisible({ timeout: 15_000 });
            await expect(bar.getByTestId('poll-share-copy')).toBeVisible();
            await expect(bar.getByTestId('poll-share-reset'), 'the creator may reset the link').toBeVisible();
        } finally {
            if (lineupId !== null) await apiDelete(token, `/lineups/${lineupId}`).catch(() => {});
        }
    });

    test('a signed-out visitor sees the preview and a sign-in CTA, not the poll or its members', async ({ browser }) => {
        const token = await getAdminToken();
        const poll = await seedPrivatePoll(token);
        const { context, page } = await openAnonContext(browser);
        try {
            // The public preview payload carries no member identities at all.
            const previewRes = await fetch(`${API_BASE}/scheduling-polls/share/${poll.shareToken}`);
            expect(previewRes.status, 'anonymous preview').toBe(200);
            const preview = (await previewRes.json()) as Record<string, unknown>;
            expect(Object.keys(preview).sort()).toEqual(
                ['creatorDisplayName', 'gameCoverUrl', 'gameName', 'isOpen', 'memberCount'],
            );

            await page.goto(`/p/poll/${poll.shareToken}`);
            await expect(page.getByRole('heading', { level: 1, name: String(preview.gameName) }))
                .toBeVisible({ timeout: 15_000 });
            await expect(page.getByText(/invited you to vote on a time to play/)).toBeVisible();
            await expect(page.getByTestId('poll-share-status')).toHaveText('Open');
            await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible();
            await expect(page, 'no login bounce — the share page is public').toHaveURL(new RegExp(`/p/poll/${poll.shareToken}$`));
            await expect(page.getByTestId('scheduling-composite'), 'the poll itself is not rendered').toHaveCount(0);
        } finally {
            await context.close();
            await apiDelete(token, `/lineups/${poll.lineupId}`).catch(() => {});
        }
    });

    test('a signed-in member opens the link, joins, lands on the poll page and votes', async ({ browser }) => {
        const token = await getAdminToken();
        const poll = await seedPrivatePoll(token);
        // The admin's suggestion auto-votes YES, so the time leads on the card.
        const slotId = await suggestTime(token, poll);
        const member = await openMemberContext(browser);
        try {
            await apiPatch(member.jwt, '/users/me/game-time/confirm', {});
            expect(
                await apiGet(member.jwt, `/lineups/${poll.lineupId}/schedule/${poll.pollId}`),
                'before joining, the member cannot read the private poll',
            ).toBeNull();

            await member.page.goto(`/p/poll/${poll.shareToken}`);
            await expect(member.page).toHaveURL(new RegExp(`${pollPagePath(poll)}$`), { timeout: 20_000 });
            await expect(member.page.getByTestId('scheduling-composite')).toBeVisible({ timeout: 15_000 });
            await dismissGameTimeCheck(member.page);
            await waitForPollReadable(member.jwt, poll);

            const yes = leaderYesToggle(member.page);
            await expect(yes, 'the member has not voted yet').toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
            await yes.click();
            await expect(yes).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
            await pollForCondition(
                async () => {
                    const data = (await apiGet(member.jwt, `/lineups/${poll.lineupId}/schedule/${poll.pollId}`)) as
                        { myVotedSlotIds?: number[] } | null;
                    return data?.myVotedSlotIds?.includes(slotId) ? data : null;
                },
                { timeoutMs: 15_000, description: `the member's YES on slot ${slotId} to persist` },
            );
        } finally {
            await member.context.close();
            await apiDelete(token, `/lineups/${poll.lineupId}`).catch(() => {});
        }
    });

    test('resetting the link invalidates the old one', async ({ page, browser }) => {
        const token = await getAdminToken();
        const poll: PrivatePoll = await seedPrivatePoll(token);
        const anon = await openAnonContext(browser);
        try {
            await waitForPollReadable(token, poll);
            await page.goto(pollPagePath(poll));
            await expect(page.getByTestId('scheduling-composite')).toBeVisible({ timeout: 15_000 });
            await dismissGameTimeCheck(page);
            await page.getByTestId('poll-share-reset').click();

            const dialog = page.getByRole('dialog').filter({ hasText: 'Reset link?' });
            await expect(dialog).toBeVisible({ timeout: 10_000 });
            const reset = page.waitForResponse(
                (r) => new URL(r.url()).pathname.endsWith(`/scheduling-polls/${poll.pollId}/share-token/reset`),
                { timeout: 20_000 },
            );
            await dialog.getByRole('button', { name: 'Reset link', exact: true }).click();
            const res = await reset;
            expect(res.status(), 'POST share-token/reset').toBe(200);
            const { shareToken: newToken } = (await res.json()) as { shareToken: string };
            expect(newToken, 'reset issues a different token').not.toBe(poll.shareToken);
            await expect(dialog).toBeHidden({ timeout: 10_000 });

            await anon.page.goto(`/p/poll/${poll.shareToken}`);
            await expect(anon.page.getByRole('alert'), 'the old link shows the invalid state')
                .toHaveText(INVALID_LINK, { timeout: 15_000 });
            await expect(anon.page.getByRole('button', { name: 'Sign in with Discord' })).toHaveCount(0);

            await anon.page.goto(`/p/poll/${newToken}`);
            await expect(anon.page.getByRole('button', { name: 'Sign in with Discord' }), 'the new link previews')
                .toBeVisible({ timeout: 15_000 });
        } finally {
            await anon.context.close();
            await apiDelete(token, `/lineups/${poll.lineupId}`).catch(() => {});
        }
    });
});
