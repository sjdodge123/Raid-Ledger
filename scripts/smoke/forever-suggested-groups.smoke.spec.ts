/**
 * ROK-2212 — the WoW: Forever guild hub's "Suggested groups" (desktop + mobile).
 *
 * G1 — a member sees the Overview widget (1–3 cards, one per dungeon), follows
 *      "See all" to `#dungeon-planner`, filters the "Suggested groups" section to
 *      the seeded dungeon and finds a group holding an unclaimed roster row.
 *      "Open in planner" loads that group into the planner in place: the dungeon
 *      and 5 chips, the unclaimed one (`m<memberId>`) included.
 * G2 — Schedule on that group lands on `/events/new` with the dungeon chip
 *      pre-selected and a "Will invite" line that never names the unclaimed row.
 *
 * Visitor coverage (no Schedule / Poll) is the W5 unit test: a Forever guild's
 * seeded `outsider` gets the ROK-2132 join gate, and the storageState admin is
 * staff, who may act — no browser identity is a plain visitor.
 *
 * Fixture: `POST /admin/test/wow/seed-guild {withSuggestedGroup:true}` (ROK-2212
 * lane C, L14) per test, with a per-project, per-worker, per-run name: one listed
 * Forever dungeon, 7 claimed characters across 6 owners + unclaimed healer / dps
 * (+ a role-less one) all inside its level span. Seeded users are deleted in `finally`.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

type Role = 'gm' | 'officer' | 'member' | 'outsider';
interface SgCharacter { userId: number; name: string }
interface SgUnclaimed { memberId: number; key: string; name: string }
interface SuggestedGroupSeed {
    instanceId: number;
    instanceName: string;
    characters: Record<string, SgCharacter>;
    unclaimed: Record<'healer' | 'dps' | 'noRole', SgUnclaimed>;
    hubPath: string;
}
interface Seeded { guildId: number; users: Record<Role, { userId: number }>; suggestedGroup: SuggestedGroupSeed }

const TAB_ID = 'dungeon-planner';

async function seed(token: string, testInfo: TestInfo): Promise<Seeded> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: `Suggested ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`,
        withSuggestedGroup: true,
    })) as Partial<Seeded> | null;
    if (typeof body?.guildId !== 'number' || !body.users || !body.suggestedGroup) {
        throw new Error(`[forever-suggested-groups] seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users, suggestedGroup: body.suggestedGroup };
}

/** Seed, run `body`, always delete every seeded user (guild roles + the group's owners). */
async function withSuggestedGuild(testInfo: TestInfo, body: (s: Seeded) => Promise<void>): Promise<void> {
    const token = await getAdminToken();
    const seeded = await seed(token, testInfo);
    const ids = new Set([...Object.values(seeded.users), ...Object.values(seeded.suggestedGroup.characters)].map((u) => u.userId));
    try {
        await body(seeded);
    } finally {
        for (const id of ids) await apiDelete(token, `/users/${id}`).catch(() => undefined);
    }
}

/** A card's accessible name: "<dungeon> group", or "<dungeon> group N of M" when the dungeon lists several. */
function isGroupOf(label: string, instanceName: string): boolean {
    const name = instanceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${name} group( \\d+ of \\d+)?$`).test(label);
}

function section(page: Page): Locator {
    return page.getByTestId('suggested-groups-section');
}

/** The first section card that holds an unclaimed roster row, and that row. */
async function cardWithUnclaimed(page: Page, sg: SuggestedGroupSeed): Promise<{ card: Locator; row: SgUnclaimed }> {
    const card = section(page).getByTestId('suggested-group-card').filter({ hasText: 'Unclaimed' }).first();
    await expect(card, 'a suggested group holds an unclaimed roster row (spec I2)').toBeVisible({ timeout: 20_000 });
    for (const row of [sg.unclaimed.healer, sg.unclaimed.dps]) {
        if ((await card.getByText(row.name, { exact: true }).count()) > 0) return { card, row };
    }
    throw new Error(`[forever-suggested-groups] the card's unclaimed member is neither ${sg.unclaimed.healer.name} nor ${sg.unclaimed.dps.name}`);
}

/** Overview → widget → See all → the planner tab's section, filtered to the seeded dungeon. */
async function openSectionFromWidget(page: Page, s: Seeded): Promise<void> {
    const sg = s.suggestedGroup;
    await page.goto(sg.hubPath);
    const widget = page.getByRole('region', { name: 'Suggested groups', exact: true });
    const cards = widget.getByTestId('suggested-group-card');
    await expect(cards.first(), 'the Overview widget shows a suggested group').toBeVisible({ timeout: 20_000 });
    expect(await cards.count(), 'the widget shows at most 3 groups').toBeLessThanOrEqual(3);
    await page.getByTestId('forever-see-all-suggested-groups').click();
    await expect(page, 'See all opens the planner tab').toHaveURL(new RegExp(`#${TAB_ID}$`));
    await expect(section(page).getByRole('heading', { name: 'Suggested groups' })).toBeVisible({ timeout: 20_000 });
    await section(page).getByLabel('Show groups for').selectOption(String(sg.instanceId));
    const shown = section(page).getByTestId('suggested-group-card');
    await expect(shown.first(), `the section lists a ${sg.instanceName} group`).toBeVisible();
    await expect.poll(
        async () => (await shown.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '')))
            .filter((l) => !isGroupOf(l, sg.instanceName)),
        { message: 'the filter keeps only the seeded dungeon' },
    ).toEqual([]);
}

test.describe('Suggested groups on WoW: Forever guild hubs (ROK-2212)', () => {
    test('G1: widget → See all → filtered section → Open in planner loads all 5 picks incl. the unclaimed one', async ({ page }, testInfo) => {
        await withSuggestedGuild(testInfo, async (s) => {
            const sg = s.suggestedGroup;
            await signInOnboardedMember(page, s.users.member.userId);
            await openSectionFromWidget(page, s);
            const { card, row } = await cardWithUnclaimed(page, sg);
            await card.getByRole('button', { name: /^Open in planner: / }).click();
            await expect.poll(() => new URL(page.url()).searchParams.get('d'), { message: 'the plan carries the dungeon' })
                .toBe(String(sg.instanceId));
            const planner = page.getByTestId('dungeon-planner');
            await expect(planner.getByTestId('planner-group').getByTestId(/^planner-chip-/), 'all 5 picks are loaded').toHaveCount(5);
            await expect(planner.getByTestId(`planner-chip-${row.key.toLowerCase()}`), 'the unclaimed pick is loaded').toBeVisible();
            expect(new URL(page.url()).hash, 'the planner tab stays open').toBe(`#${TAB_ID}`);
        });
    });

    test('G2: Schedule lands on Create Event with the dungeon picked, inviting only claimed members', async ({ page }, testInfo) => {
        await withSuggestedGuild(testInfo, async (s) => {
            const sg = s.suggestedGroup;
            await signInOnboardedMember(page, s.users.member.userId);
            await openSectionFromWidget(page, s);
            const { card, row } = await cardWithUnclaimed(page, sg);
            await card.getByTestId('suggested-group-schedule').click();
            await expect(page).toHaveURL(/\/events\/new\?/);
            expect(new URL(page.url()).searchParams.get('contentInstanceIds'), 'Schedule carries the dungeon').toBe(String(sg.instanceId));
            await expect(page.getByRole('button', { name: `Remove ${sg.instanceName}` }), 'the dungeon chip is pre-selected')
                .toBeVisible({ timeout: 20_000 });
            const invite = page.getByTestId('invite-preview-line');
            await expect(invite, 'the claimed members are named').toContainText('Will invite:', { timeout: 15_000 });
            await expect(invite, 'the unclaimed row is never invited').not.toContainText(row.name);
        });
    });
});
