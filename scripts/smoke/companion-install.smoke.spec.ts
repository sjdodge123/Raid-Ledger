/**
 * ROK-2060 (deferred from ROK-2056) — the Companion install entry points now
 * `COMPANION_DOWNLOAD_AVAILABLE` is on. Desktop AND mobile.
 *
 * 1. My Integrations: the "Raid Ledger Companion" card (Beta chip, Download →
 *    the GitHub releases page in a new tab, three steps, unsigned-build note),
 *    scrolled into view for `#companion` and `#companion-devices`.
 * 2. Hub Overview: a BG3 hub member with no linked computer sees the "install
 *    the Companion" card first in the grid, once the "claim your character"
 *    prompt (ROK-2153 S6, one banner at a time) is dismissed; "Not now" stores a per-hub
 *    dismissal server-side, so it stays hidden after a reload. A visitor
 *    (non-member) never sees it.
 * 3. The BG3 Party `no-saves` empty state carries the one-line install link.
 *
 * Fixture: `POST /admin/test/bg3/seed-hub` with a tag unique to spec × project ×
 * worker. The seeded users never link a Companion device, so the "not linked"
 * gates hold. The seed does not clear onboarding dismissals, so the dismissal
 * test restores its own before it starts and again in `finally` — reruns on a
 * preserved env see the card again. No sleeps; writes are confirmed against
 * `GET /guilds/onboarding` with `pollForCondition`.
 */
import type { Page, TestInfo } from '@playwright/test';
import { COMPANION_DOWNLOAD_URL } from '@raid-ledger/contract';
import { test, expect } from './base';
import { API_BASE, apiDelete, apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { hubSeedTag } from './hub-seed';

const PROMPT_KEY = 'companion-install';
const PROMPT_HEADING = 'Upload your saves automatically';
const RELEASES_URL = 'https://github.com/Raid-Ledger-Plugins/rl-companion/releases';

type Variant = 'default' | 'no-saves';
type Role = 'member' | 'visitor';

interface Seed {
    hubId: number;
    users: Record<Role, { userId: number }>;
}

interface OnboardingState {
    dismissed: { key: string; guildId: number | null }[];
}

/** Same as `bg3-hub-widgets`: install falls through to activate when already installed. */
async function ensurePluginActive(token: string, pluginId: string): Promise<void> {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
    const install = await fetch(`${API_BASE}/admin/plugins/${pluginId}/install`, init);
    if (install.ok) return;
    const activate = await fetch(`${API_BASE}/admin/plugins/${pluginId}/activate`, init);
    if (!activate.ok) throw new Error(`failed to enable the ${pluginId} plugin: install ${install.status}, activate ${activate.status}`);
}

async function seedHub(testInfo: TestInfo, variant: Variant): Promise<Seed> {
    const token = await getAdminToken();
    const body = (await apiPost(token, '/admin/test/bg3/seed-hub', {
        tag: hubSeedTag('bg3comp', testInfo),
        variant,
    })) as Partial<Seed> | null;
    if (typeof body?.hubId !== 'number' || !body.users?.member || !body.users.visitor) {
        throw new Error(`bg3 seed-hub: ${JSON.stringify(body)}`);
    }
    return { hubId: body.hubId, users: body.users };
}

function dismissPath(hubId: number): string {
    return `/guilds/onboarding/${PROMPT_KEY}/dismiss?guildId=${hubId}`;
}

/** Poll the viewer's dismissal state until this hub's Companion dismissal is `want`. */
async function waitForDismissed(jwt: string, hubId: number, want: boolean): Promise<void> {
    await pollForCondition(
        async () => {
            const state = (await apiGet(jwt, '/guilds/onboarding')) as OnboardingState | null;
            if (!state) return null;
            const has = state.dismissed.some((d) => d.key === PROMPT_KEY && d.guildId === hubId);
            return has === want ? true : null;
        },
        { timeoutMs: 15_000, description: `${PROMPT_KEY} dismissal for hub ${hubId} = ${want}` },
    );
}

async function restoreDismissal(jwt: string, hubId: number): Promise<void> {
    await apiDelete(jwt, dismissPath(hubId));
    await waitForDismissed(jwt, hubId, false);
}

function companionCard(page: Page) {
    return page.locator('section#companion-devices');
}

test.describe('Companion install entry points (ROK-2060)', () => {
    test.beforeAll(async () => {
        // Fail loudly, never skip: the hub prompt and the Party card need the bg3 plugin.
        await ensurePluginActive(await getAdminToken(), 'bg3');
    });

    test('My Integrations: the Raid Ledger Companion card with Download, steps and the unsigned note', async ({ page }, testInfo) => {
        expect(COMPANION_DOWNLOAD_URL, 'the contract points Download at the public releases page').toBe(RELEASES_URL);
        const seed = await seedHub(testInfo, 'default');
        await signInOnboardedMember(page, seed.users.member.userId);
        await page.goto('/profile/integrations#companion');
        const card = companionCard(page);
        await expect(card.getByRole('heading', { name: 'Raid Ledger Companion', level: 2 }), 'released heading').toBeVisible({
            timeout: 20_000,
        });
        await expect(card, '#companion scrolls the card into view').toBeInViewport();
        await expect(card.getByText('Beta', { exact: true }), 'the Beta chip').toBeVisible();
        const download = card.getByTestId('companion-download');
        await expect(download, 'Download is a link').toHaveText('Download');
        await expect(download, 'Download points at the releases page').toHaveAttribute('href', RELEASES_URL);
        await expect(download, 'Download opens a new tab').toHaveAttribute('target', '_blank');
        await expect(download, 'the new tab gets no opener').toHaveAttribute('rel', /\bnoopener\b/);
        const steps = card.getByTestId('companion-install-steps').getByRole('listitem');
        await expect(steps, 'three install steps').toHaveCount(3);
        await expect(steps.nth(1)).toContainText('Link this computer');
        await expect(steps.nth(2)).toContainText('/link');
        await expect(card.getByTestId('companion-unsigned-note'), 'the unsigned-build note').toContainText('Unsigned test build.');

        // A full navigation away first, so the second anchor is a fresh landing, not a same-document hash change.
        await page.goto('/calendar');
        await page.goto('/profile/integrations#companion-devices');
        await expect(card.getByRole('heading', { name: 'Raid Ledger Companion', level: 2 })).toBeVisible({ timeout: 20_000 });
        await expect(card, '#companion-devices scrolls the card into view').toBeInViewport();
    });

    test('Hub Overview: the install card follows the claim prompt for a member; "Not now" keeps it hidden after reload', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo, 'default');
        const jwt = await signInOnboardedMember(page, seed.users.member.userId);
        await restoreDismissal(jwt, seed.hubId);
        try {
            await page.goto(`/hubs/${seed.hubId}`);
            // ROK-2153 S6: one Overview banner at a time. The seeded member has no claimed character, so the
            // claim prompt asks first and the install card waits until that prompt is answered.
            const claim = page.getByTestId('hub-claim-prompt');
            await expect(claim, 'the claim prompt shows first').toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('companion-install-prompt'), 'the install card waits for the claim prompt').toHaveCount(0);
            await claim.getByTestId('hub-claim-prompt-dismiss').click();
            await expect(claim, 'the claim prompt is dismissed').toHaveCount(0);
            const prompt = page.getByTestId('companion-install-prompt');
            await expect(prompt.getByRole('heading', { name: PROMPT_HEADING }), 'the BG3 prompt heading').toBeVisible({ timeout: 20_000 });
            const firstCell = page.getByTestId('guild-overview').locator(':scope > *').first();
            await expect(firstCell, 'the prompt is the first cell of the Overview grid').toHaveAttribute('data-testid', 'companion-install-prompt');
            await expect(prompt.getByTestId('companion-install-prompt-install'), 'Install links to the My Integrations card')
                .toHaveAttribute('href', '/profile/integrations#companion');

            await prompt.getByTestId('companion-install-prompt-dismiss').click();
            await expect(prompt, '"Not now" hides the card').toHaveCount(0);
            await waitForDismissed(jwt, seed.hubId, true);

            await page.reload();
            await expect(page.getByTestId('bg3-party-slot').first(), 'the Overview rendered again').toBeVisible({ timeout: 20_000 });
            await expect(page.getByTestId('companion-install-prompt'), 'still dismissed after reload').toHaveCount(0);
        } finally {
            await restoreDismissal(jwt, seed.hubId);
        }
    });

    test('Hub Overview: a visitor (not a member) never sees the install card', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo, 'default');
        await signInOnboardedMember(page, seed.users.visitor.userId);
        await page.goto(`/hubs/${seed.hubId}`);
        // The member gate runs in the same render as the grid: once the grid is mounted, the prompt cell has decided.
        await expect(page.getByTestId('guild-overview'), 'the Overview grid mounted for the visitor').toBeAttached({ timeout: 20_000 });
        await expect(page.getByTestId('companion-install-prompt'), 'no install card for a non-member').toHaveCount(0);
    });

    test('BG3 Party "no saves" empty state carries the install link', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo, 'no-saves');
        await signInOnboardedMember(page, seed.users.member.userId);
        await page.goto(`/hubs/${seed.hubId}`);
        const empty = page.getByTestId('bg3-party-empty');
        await expect(empty, 'the no-saves empty state').toContainText('No saves in', { timeout: 20_000 });
        const line = empty.getByTestId('companion-install-link');
        await expect(line, 'the one-line Companion lead').toContainText('Saves can upload by themselves');
        await expect(line.getByRole('link', { name: 'install the Companion' }), 'links to the My Integrations card')
            .toHaveAttribute('href', '/profile/integrations#companion');
    });
});
