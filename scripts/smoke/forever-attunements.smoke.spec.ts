/**
 * ROK-1927 — the WoW: Forever Attunement tracker. Desktop AND mobile.
 *
 * Fixtures: `POST /admin/test/wow/seed-guild` (a per-project, per-worker,
 * per-run Forever guild: five roster rows — Aldren (gm), Brisa (officer) and
 * Dainel (member) linked, Corvin + Elowen unlinked — plus an outsider with no
 * character), then `POST /admin/test/wow/seed-attunements`
 * (`api/src/admin/demo-test-attunements.helpers.ts`): it stores Blizzard
 * Forever quest rows for the Horde Onyxia chain (an attunement shows only when
 * its FINAL quest is confirmed — Lead call 2026-11-12), makes the three linked
 * characters Orcs and gives them Armory completed lists: Aldren the whole
 * chain (Attuned), Brisa its first three quests (In progress), Dainel none
 * (Not started). The unlinked rows have no character: "No data — not claimed".
 *
 * Both writes land BEFORE anything reads roster-insights (5-minute cache);
 * the spec polls the endpoint until the seeded counts show, then asserts:
 *   - the Overview card's Onyxia row: `1/5 attuned`, "1 in progress";
 *   - "See who" opens ONE dialog — a table at desktop (Modal), a list on the
 *     phone (BottomSheet) — rows sorted done → in progress → not started → no
 *     data, the unclaimed rows "Not claimed", a claimed name linking to its
 *     character's Quests section;
 *   - the in-progress member's own character page lists the checklist;
 *   - a visitor (the outsider, a non-member: the ROK-2132 join gate) never
 *     gets the section or the card.
 *
 * Seeded users are deleted in `finally`; the guild row and the confirmed quest
 * rows stay (the latter are what the real import writes; idempotent).
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

const GAME_SLUG = 'world-of-warcraft-forever';
const INSTANCE = "Onyxia's Lair";
const GROUP_KEY = 'onyxia';
const ROSTER_SIZE = 5;
const DONE_NAME = 'Aldren';
const SORTED_STATES = ['done', 'in_progress', 'not_started', 'no_data', 'no_data'];
/** attunement-rows.tsx swaps the table for a list below 768px. */
const TABLE_MIN_WIDTH = 768;

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number; characterId: string | null }>;
}

interface SeededAttunement {
    key: string;
    instance: string;
    steps: string[];
    inProgressSteps: number;
}

interface AttunementCounts {
    done: number;
    inProgress: number;
    notStarted: number;
    noData: number;
}

interface InsightsBody {
    attunements?: { attunements: { key: string; counts: AttunementCounts }[] };
}

function guildName(testInfo: TestInfo): string {
    return `Attune ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

function linkedCharacter(guild: SeededGuild, role: Role): string {
    const id = guild.users[role].characterId;
    if (id === null) throw new Error(`seed-guild: the ${role} should own a linked character`);
    return id;
}

async function seedCast(token: string, testInfo: TestInfo): Promise<{ guild: SeededGuild; attunement: SeededAttunement }> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo), gameSlug: GAME_SLUG })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    const guild = { guildId: body.guildId, users: body.users };
    const seeded = (await apiPost(token, '/admin/test/wow/seed-attunements', {
        characters: {
            done: linkedCharacter(guild, 'gm'),
            inProgress: linkedCharacter(guild, 'officer'),
            notStarted: linkedCharacter(guild, 'member'),
        },
    })) as Partial<SeededAttunement>;
    if (seeded.key !== 'ony-horde' || !Array.isArray(seeded.steps) || typeof seeded.inProgressSteps !== 'number') {
        throw new Error(`seed-attunements: ${JSON.stringify(seeded)}`);
    }
    return { guild, attunement: seeded as SeededAttunement };
}

async function removeUsers(token: string, guild: SeededGuild): Promise<void> {
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

/** Poll roster-insights as a member until the Horde Onyxia def carries the seeded counts. */
async function waitForAttunements(jwt: string, guildId: number): Promise<AttunementCounts> {
    return pollForCondition(
        async () => {
            const data = (await apiGet(jwt, `/plugins/wow/guilds/${guildId}/roster-insights`)) as InsightsBody | null;
            const def = data?.attunements?.attunements.find((a) => a.key === 'ony-horde');
            return def && def.counts.done === 1 ? def.counts : null;
        },
        { timeoutMs: 15_000, description: `roster-insights for guild ${guildId} carries the seeded Onyxia attunement` },
    );
}

async function openOverview(page: Page, guildId: number): Promise<void> {
    await page.goto(`/hubs/${guildId}`);
    await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
}

test.describe('WoW: Forever attunements (ROK-1927)', () => {
    test('Overview card counts the group; See who lists every member sorted by state', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        const { guild } = await seedCast(token, testInfo);
        try {
            const jwt = await signInOnboardedMember(page, guild.users.member.userId);
            const counts = await waitForAttunements(jwt, guild.guildId);
            expect(counts, 'the API counts one attuned, one in progress, one not started and the two unclaimed rows').toEqual({ done: 1, inProgress: 1, notStarted: 1, noData: 2 });
            await openOverview(page, guild.guildId);

            const region = page.getByRole('region', { name: 'Attunements', exact: true });
            await expect(region, 'a guild member sees the Attunements card on a Forever guild Overview').toBeVisible({ timeout: 20_000 });
            const row = region.getByTestId(`attunement-row-${GROUP_KEY}`);
            await expect(row).toContainText(INSTANCE);
            await expect(row.getByTestId('attunement-count'), 'the row reads done/total attuned').toHaveText(`1/${ROSTER_SIZE} attuned`);
            await expect(row.getByTestId('attunement-note'), 'the muted line counts the in-progress member').toContainText('1 in progress');

            await region.getByRole('button', { name: 'See who' }).click();
            const dialog = page.getByRole('dialog', { name: 'Attunements' });
            await expect(dialog, 'See who opens exactly one detail overlay').toHaveCount(1);
            await expect(dialog).toBeVisible();
            await dialog.getByRole('button', { name: INSTANCE }).click();
            const members = dialog.getByTestId('attunement-member');
            await expect(members, 'one row per roster main').toHaveCount(ROSTER_SIZE);
            await expect
                .poll(() => members.evaluateAll((els) => els.map((el) => el.getAttribute('data-state'))), { message: 'rows sort done → in progress → not started → no data' })
                .toEqual(SORTED_STATES);
            await expect(members.first()).toContainText(DONE_NAME);
            await expect(members.first()).toContainText('Attuned');
            await expect(members.nth(1)).toContainText('In progress');
            await expect(members.nth(2)).toContainText('Not started');
            for (const i of [3, 4]) {
                await expect(members.nth(i), 'an unclaimed roster row reads Not claimed').toContainText('Not claimed');
                await expect(members.nth(i).getByRole('link'), 'an unclaimed row has no character link').toHaveCount(0);
            }
            const gmChar = linkedCharacter(guild, 'gm');
            await expect(members.first().getByRole('link', { name: DONE_NAME }), 'a claimed name links to its Quests section').toHaveAttribute('href', `/characters/${gmChar}#quests`);

            const wide = (page.viewportSize()?.width ?? 0) >= TABLE_MIN_WIDTH;
            await expect(dialog.locator('table'), wide ? 'desktop shows the member table' : 'the phone shows a list, not a table').toHaveCount(wide ? 1 : 0);
        } finally {
            await removeUsers(token, guild);
        }
    });

    test("the member's own character page lists the attunement checklist", async ({ page }, testInfo) => {
        const token = await getAdminToken();
        const { guild, attunement } = await seedCast(token, testInfo);
        try {
            await signInOnboardedMember(page, guild.users.officer.userId);
            await page.goto(`/characters/${linkedCharacter(guild, 'officer')}`);
            const block = page.getByTestId('character-attunements');
            await expect(block, 'the Quests section carries the Attunements block for the owner').toBeVisible({ timeout: 20_000 });
            await expect(block.getByRole('heading', { name: 'Attunements' })).toBeVisible();
            const row = block.locator('[data-testid="character-attunement"][data-state="in_progress"]');
            await expect(row, 'the in-progress chain is listed').toHaveCount(1);
            await expect(row).toContainText(`${INSTANCE} — ${attunement.inProgressSteps} of ${attunement.steps.length} steps`);
            const steps = row.getByRole('list', { name: `${INSTANCE} steps` }).getByRole('listitem');
            await expect(steps, 'an in-progress chain starts open with every confirmed step').toHaveCount(attunement.steps.length);
            const next = steps.nth(attunement.inProgressSteps);
            await expect(next, 'the first incomplete step is marked Next').toContainText('Next');
            await expect(next).toContainText(attunement.steps[attunement.inProgressSteps] ?? 'missing step label');
        } finally {
            await removeUsers(token, guild);
        }
    });

    test('a visitor gets no attunements section and never sees the card', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        const { guild } = await seedCast(token, testInfo);
        try {
            const jwt = await signInOnboardedMember(page, guild.users.outsider.userId);
            const insights = (await apiGet(jwt, `/plugins/wow/guilds/${guild.guildId}/roster-insights`)) as Record<string, unknown> | null;
            expect(insights === null || !('attunements' in insights), 'a visitor response carries no attunements key').toBe(true);
            await page.goto(`/hubs/${guild.guildId}`);
            await expect(page.getByTestId('wow-join-gate'), 'a non-member of a Forever guild gets the join gate (ROK-2132)').toBeVisible({ timeout: 15_000 });
            await expect(page.getByTestId('guild-overview'), 'no Overview renders behind the gate').toHaveCount(0);
            await expect(page.getByRole('region', { name: 'Attunements', exact: true }), 'the card never mounts for a visitor').toHaveCount(0);
        } finally {
            await removeUsers(token, guild);
        }
    });
});
