/**
 * ROK-1464 — `/lfg/:gameSlug`, the LFG group page (desktop + mobile).
 *
 * Drives the whole loop the page exists for:
 *   LFG (1 looking) → +1 → LFM (2 looking) → Withdraw → back to LFG →
 *   +1 → Find a time → the scheduling poll, with the viewer's intent converted.
 *
 * Two things are asserted through the API rather than the UI:
 *   • the intent count after each write — React Query's 15s `staleTime` will
 *     happily re-render a stale empty fetch (TESTING.md "When to poll the API"),
 *   • the post-convert intent state, which has no rendered surface (D9).
 *
 * Overlap: seeding two users' game-time availability is out of reach from a
 * smoke fixture, so this spec asserts the panel's DERIVED states (the
 * needs-two message at one member, the seven-day strip at two). The D4
 * `Start poll` → `suggest` seeding is covered by
 * `web/src/hooks/use-lfg-actions.test.ts`.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import {
    getAdminToken,
    getInviteeFixture,
    apiGet,
    apiPost,
    apiDelete,
    pollForCondition,
} from './api-helpers';

const HOOK_TIMEOUT_MS = 90_000;

let adminToken: string;
let inviteeToken: string;
let gameId: number;
let gameSlug: string;

/**
 * Catalogue games with usable slugs, in discover order. The page is
 * slug-addressed, so a game without one is not reachable.
 */
async function pickGames(token: string): Promise<Array<{ id: number; slug: string }>> {
    const discover = await apiGet(token, '/games/discover');
    const seen = new Set<number>();
    const games: Array<{ id: number; slug: string }> = [];
    for (const row of discover?.rows ?? []) {
        for (const game of row.games ?? []) {
            if (!game?.id || typeof game.slug !== 'string' || !game.slug) continue;
            if (seen.has(game.id)) continue;
            seen.add(game.id);
            games.push({ id: game.id, slug: game.slug });
        }
    }
    return games;
}

/**
 * LFG state is keyed by (user, game) and both Playwright projects run
 * concurrently against ONE API with the SAME admin + invitee. Sharing a game
 * would make desktop and mobile withdraw and convert each other's intents
 * mid-assertion, so each project takes its own game out of the catalogue.
 */
const PROJECT_GAME_INDEX: Record<string, number> = { desktop: 0, mobile: 1 };

/** Active LFG intent count for the game, straight from the API. */
async function activeCount(token: string): Promise<number> {
    const group = await apiGet(token, `/lfg/${gameId}`);
    return group?.activeCount ?? 0;
}

/**
 * Wait until the API agrees before asserting on a `useQuery`-backed panel.
 * Returns a diagnostic string rather than a bare `true` so a timeout prints
 * the last observed value instead of `(none)`.
 */
async function waitForCount(token: string, expected: number): Promise<string> {
    return pollForCondition(
        async () => {
            const count = await activeCount(token);
            return count === expected ? `activeCount=${count}` : null;
        },
        { timeoutMs: 15_000, description: `LFG activeCount === ${expected}` },
    );
}

/** Load the group page fresh so the status bar reflects the latest read. */
async function openGroupPage(page: Page): Promise<void> {
    await page.goto(`/lfg/${gameSlug}`);
    await expect(page.getByTestId('lfg-status-bar')).toBeVisible({
        timeout: 15_000,
    });
}

test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(HOOK_TIMEOUT_MS);
    adminToken = await getAdminToken();
    inviteeToken = (await getInviteeFixture()).jwt;
    const games = await pickGames(adminToken);
    const index = PROJECT_GAME_INDEX[testInfo.project.name] ?? 0;
    const game = games[index];
    if (!game) return;
    gameId = game.id;
    gameSlug = game.slug;
    // Start from a known-empty group regardless of what a previous run left.
    await apiDelete(adminToken, `/lfg/${gameId}`);
    await apiDelete(inviteeToken, `/lfg/${gameId}`);
});

test.afterAll(async () => {
    if (!gameId) return;
    await apiDelete(adminToken, `/lfg/${gameId}`);
    await apiDelete(inviteeToken, `/lfg/${gameId}`);
});

test('LFG → LFM → withdraw, then Find a time converts the group', async ({
    page,
}) => {
    test.skip(
        !gameSlug,
        'Catalogue has fewer slugged games than Playwright projects',
    );
    test.setTimeout(HOOK_TIMEOUT_MS);

    // ---- 1 looking: someone else raised a hand, the viewer has not ---------
    await apiPost(inviteeToken, '/lfg', { gameId });
    await waitForCount(adminToken, 1);
    await openGroupPage(page);

    await expect(page.getByText('Looking for group')).toBeVisible();
    await expect(page.getByText(/^1 looking/)).toBeVisible();
    await expect(
        page.getByText('Overlap appears once two people are in'),
    ).toBeVisible();
    await expect(
        page.getByRole('button', { name: /I'm in/ }),
    ).toBeVisible();

    // ---- +1: the derived LFG → LFM transition -----------------------------
    await page.getByRole('button', { name: /I'm in/ }).click();
    await waitForCount(adminToken, 2);
    await expect(page.getByText('Looking for members')).toBeVisible({
        timeout: 15_000,
    });
    await expect(
        page.getByRole('button', { name: 'Withdraw' }),
    ).toBeVisible();
    // Two live members: the overlap panel now has a roster to project.
    await expect(page.getByTestId('lfg-overlap-day')).toHaveCount(7);

    // ---- Withdraw: straight back to a one-person group --------------------
    await page.getByRole('button', { name: 'Withdraw' }).click();
    await waitForCount(adminToken, 1);
    await expect(page.getByText('Looking for group')).toBeVisible({
        timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /I'm in/ })).toBeVisible();

    // ---- Find a time: create → convert → navigate to the poll -------------
    await page.getByRole('button', { name: /I'm in/ }).click();
    await waitForCount(adminToken, 2);
    await page.getByRole('button', { name: 'Find a time' }).click();

    await expect(page).toHaveURL(/\/community-lineup\/\d+\/schedule\/\d+$/, {
        timeout: 30_000,
    });
    // AC6: the group no longer advertises itself once it has converted.
    await pollForCondition(
        async () => {
            const group = await apiGet(adminToken, `/lfg/${gameId}`);
            return group && group.ownIntent === null
                ? `ownIntent=null activeCount=${group.activeCount}`
                : null;
        },
        {
            timeoutMs: 20_000,
            description: 'viewer intent converted away',
        },
    );
});

test('an unknown slug renders the not-found state, not a blank page', async ({
    page,
}) => {
    await page.goto('/lfg/definitely-not-a-real-game-slug');

    await expect(page.getByTestId('lfg-not-found')).toBeVisible({
        timeout: 15_000,
    });
    await expect(page.getByTestId('lfg-status-bar')).toHaveCount(0);
});
