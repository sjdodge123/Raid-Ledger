/**
 * ROK-1958 — the BG3 hub widgets on a `game_community` hub for Baldur's Gate 3:
 * Party (start a campaign, "That's me" / "Not me"), Where we are ("Act N · <area>")
 * and the Campaign tab's spoiler toggle. Desktop AND mobile.
 *
 * Fixture: `POST /admin/test/bg3/seed-hub` with a tag unique to project × worker
 * (`hubSeedTag`), so parallel projects never share a hub. Users are
 * `bg3-<role>-<tag>`: host (hub leader, campaign host, uploader of every save),
 * member (no claim) and claimer (holds the Human Wizard). The history is 24
 * sessions; the newest save is the golden Act 2 party (4 heroes + 1 summon,
 * area `SCL_Main_A`). Variants: `no-campaign` (host's saves unassigned, no
 * campaign) and `default` (active campaign "Tactician run", one claim).
 *
 * Every UI write is confirmed against `GET /plugins/bg3/hubs/:id/snapshot`
 * with `pollForCondition` before the next step relies on it. No sleeps.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { hubSeedTag } from './hub-seed';

/** Mirrors `BG3_GAME_SLUGS` (ROK-2038): the boot seed writes the first. */
const GAME_SLUGS = ['baldurs-gate-iii', 'baldurs-gate-3'] as const;
const CAMPAIGN_NAME = 'Smoke run';
const WHERE_TEXT = 'Act 2 · Shadow-Cursed Lands';
const SPOILERS_LINE = 'Location and screenshots are hidden on this hub.';
const HERO_COUNT = 4;

type Variant = 'default' | 'no-campaign';
type Role = 'host' | 'member' | 'claimer';

interface Seed {
    hubId: number;
    campaignId: number | null;
    users: Record<Role, { userId: number }>;
}

interface SnapshotSlot {
    slotKey: string | null;
    isSummon: boolean;
    claim: { userId: number } | null;
}

type Snapshot = { empty: true } | { empty: false; party: SnapshotSlot[]; spoilersHidden: boolean };

async function seedHub(testInfo: TestInfo, variant: Variant): Promise<Seed> {
    const token = await getAdminToken();
    const body = (await apiPost(token, '/admin/test/bg3/seed-hub', {
        tag: hubSeedTag('bg3', testInfo),
        variant,
    })) as Partial<Seed> | null;
    if (typeof body?.hubId !== 'number' || !body.users) throw new Error(`bg3 seed-hub: ${JSON.stringify(body)}`);
    return { hubId: body.hubId, campaignId: body.campaignId ?? null, users: body.users };
}

async function snapshot(jwt: string, hubId: number): Promise<Snapshot | null> {
    return (await apiGet(jwt, `/plugins/bg3/hubs/${hubId}/snapshot`)) as Snapshot | null;
}

/** Poll the snapshot until `pick` returns a value. */
async function waitForSnapshot<T>(jwt: string, hubId: number, what: string, pick: (s: Snapshot) => T | null): Promise<T> {
    return pollForCondition(
        async () => {
            const s = await snapshot(jwt, hubId);
            return s ? pick(s) : null;
        },
        { timeoutMs: 15_000, description: `bg3 snapshot for hub ${hubId}: ${what}` },
    );
}

/** The first hero slot (the fixture's Wood Elf Barbarian, unclaimed in every variant). */
function firstHeroSlot(s: Snapshot): SnapshotSlot | null {
    if (s.empty) return null;
    return s.party.find((m) => !m.isSummon) ?? null;
}

async function openHub(page: Page, hubId: number, hash = ''): Promise<void> {
    await page.goto(`/hubs/${hubId}${hash}`);
}

function partyList(page: Page) {
    return page.getByRole('list', { name: 'Party', exact: true });
}

test.describe('BG3 hub widgets (ROK-1958)', () => {
    test.beforeAll(async () => {
        // Fail loudly, never skip: a silent skip hid the slug bug (ROK-2038).
        const token = await getAdminToken();
        const ids: number[] = [];
        for (const slug of GAME_SLUGS) {
            const game = (await apiGet(token, `/games/slug/${slug}`)) as { id?: number } | null;
            if (typeof game?.id === 'number') ids.push(game.id);
        }
        expect(ids.length, `no BG3 game (${GAME_SLUGS.join(' / ')}) in this env — the boot seed did not run`).toBeGreaterThan(0);
    });

    test('Party: empty → Start a campaign files the host\'s saves and the party renders', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo, 'no-campaign');
        const jwt = await signInOnboardedMember(page, seed.users.host.userId);
        await openHub(page, seed.hubId);
        const empty = page.getByTestId('bg3-party-empty');
        await expect(empty, 'a hub with no campaign shows the Party empty state').toContainText('No campaign on this hub yet.', {
            timeout: 20_000,
        });
        await empty.getByRole('button', { name: 'Start a campaign' }).click();
        const dialog = page.getByRole('dialog', { name: 'Start a campaign' });
        await dialog.getByLabel('Campaign name').fill(CAMPAIGN_NAME);
        await expect(dialog.getByLabel('Put my saves in this campaign'), '"Put my saves" is pre-checked').toBeChecked();
        await dialog.getByRole('button', { name: 'Start campaign' }).click();
        const heroes = await waitForSnapshot(jwt, seed.hubId, 'party present after Start a campaign', (s) =>
            s.empty ? null : s.party.filter((m) => !m.isSummon).length,
        );
        expect(heroes, 'the newest save is the 4-hero fixture party').toBe(HERO_COUNT);
        await expect(partyList(page).getByTestId('bg3-party-slot'), 'one tile per hero').toHaveCount(HERO_COUNT, { timeout: 20_000 });
        await expect(page.getByTestId('bg3-party-summons'), 'the summon is listed apart from the heroes').toBeVisible();
        await expect(empty, 'the empty state is gone').toHaveCount(0);
    });

    test('Party: "That\'s me" shows "You"; "Not me" puts the slot back', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo, 'default');
        const memberId = seed.users.member.userId;
        const jwt = await signInOnboardedMember(page, memberId);
        await openHub(page, seed.hubId);
        const tile = partyList(page).getByTestId('bg3-party-slot').first();
        await expect(tile, 'the Party card renders the seeded party').toBeVisible({ timeout: 20_000 });
        await tile.getByRole('button', { name: "That's me" }).click();
        await expect(tile.getByTestId('bg3-claim-control'), 'the claimed tile names the viewer').toContainText('You');
        const claimed = await waitForSnapshot(jwt, seed.hubId, `slot claimed by user ${memberId}`, (s) =>
            firstHeroSlot(s)?.claim?.userId === memberId ? true : null,
        );
        expect(claimed).toBe(true);
        await tile.getByRole('button', { name: 'Not me' }).click();
        await expect(tile.getByRole('button', { name: "That's me" }), '"Not me" restores the claim button').toBeVisible();
        const released = await waitForSnapshot(jwt, seed.hubId, 'first hero slot unclaimed again', (s) => {
            const slot = firstHeroSlot(s);
            return slot !== null && slot.claim === null ? true : null;
        });
        expect(released).toBe(true);
    });

    test('Where we are: shows "Act 2 · Shadow-Cursed Lands"', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo, 'default');
        await signInOnboardedMember(page, seed.users.member.userId);
        await openHub(page, seed.hubId);
        await expect(page.getByTestId('bg3-where-place'), 'the newest save\'s act and area').toHaveText(WHERE_TEXT, { timeout: 20_000 });
    });

    test('Campaign tab: the spoiler toggle hides location and screenshots on the Overview', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo, 'default');
        const jwt = await signInOnboardedMember(page, seed.users.host.userId);
        await openHub(page, seed.hubId, '#campaign');
        const toggle = page.getByRole('switch', { name: 'Hide location and screenshots' });
        await expect(toggle, 'the hub leader sees the spoiler switch').toBeVisible({ timeout: 20_000 });
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await toggle.click();
        await expect(toggle, 'the switch flips on').toHaveAttribute('aria-checked', 'true');
        const hidden = await waitForSnapshot(jwt, seed.hubId, 'spoilersHidden true', (s) =>
            !s.empty && s.spoilersHidden ? true : null,
        );
        expect(hidden).toBe(true);
        await openHub(page, seed.hubId);
        const where = page.getByTestId('bg3-where');
        await expect(where, 'Where we are shows the spoilers line').toContainText(SPOILERS_LINE, { timeout: 20_000 });
        await expect(where.getByTestId('bg3-where-place'), 'the area is hidden').toHaveCount(0);
    });
});
