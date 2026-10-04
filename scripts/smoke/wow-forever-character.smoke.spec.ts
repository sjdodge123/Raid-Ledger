/**
 * ROK-1721 — manual WoW: Forever character entry.
 *
 * Forever is realmless: picking it in Add Character swaps Name + Realm for
 * Region / Ruleset / First name / Second name and a "Shown in-game as"
 * preview. The detail page shows the ruleset + region ("PvP (EU)") where a
 * realm would sit, a one-word name is blocked client-side, a Region + full
 * name already held by another player is a 409, and edit mode locks Region.
 *
 * The game comes from the boot seed (`api/src/games-lookup/seed-games.data.ts`);
 * `beforeAll` resolves it by slug and skips with the reason if the env lacks it.
 * The second player is the `/admin/test/seed-fixture-user` invitee. Names are
 * letters only (the contract rejects digits), so the per-run suffix encodes
 * Date.now() as letters. Every character created is deleted in `finally`.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken, getInviteeToken, pollForCondition } from './api-helpers';
import { isMobile } from './helpers';

const GAME_NAME = 'World of Warcraft: Forever';
const GAME_SLUG = 'world-of-warcraft-forever';

interface CharRow { id: string; name: string; region: string | null; ruleset: string | null }

let gameId: number | null = null;

/** Digits → letters (0→a … 9→j); the contract allows letters only. */
function lettersOnly(digits: string): string {
    return digits.replace(/\d/g, (d) => String.fromCharCode(97 + Number(d)));
}

/** A unique "First Second" pair per test, project and run. */
function uniqueName(testInfo: TestInfo, first: string): { first: string; second: string; full: string } {
    const suffix = lettersOnly(`${Date.now() % 1e10}${testInfo.workerIndex}${testInfo.repeatEachIndex}`);
    const second = `Q${suffix}`;
    return { first, second, full: `${first} ${second}` };
}

async function listForever(token: string): Promise<CharRow[]> {
    const res = (await apiGet(token, `/users/me/characters?gameId=${gameId}`)) as { data?: CharRow[] } | null;
    return res?.data ?? [];
}

/** Poll until `token`'s character list has `fullName`; returns its row. */
async function waitForCharacter(token: string, fullName: string): Promise<CharRow> {
    return pollForCondition(
        async () => (await listForever(token)).find((c) => c.name === fullName) ?? null,
        { timeoutMs: 15_000, description: `character "${fullName}" exists` },
    );
}

/** Delete every one of `token`'s Forever characters named `fullName` (idempotent). */
async function deleteByName(token: string, fullName: string): Promise<void> {
    for (const c of await listForever(token)) {
        if (c.name === fullName) await apiDelete(token, `/users/me/characters/${c.id}`);
    }
}

async function createViaApi(token: string, fullName: string, region: string): Promise<CharRow> {
    const body = { gameId, name: fullName, region, ruleset: 'normal' };
    const created = (await apiPost(token, '/users/me/characters', body)) as Partial<CharRow> & { message?: unknown };
    expect(created.id, `API create of "${fullName}" should succeed: ${JSON.stringify(created.message ?? '')}`).toBeTruthy();
    return created as CharRow;
}

interface Form { dialog: Locator; region: Locator; ruleset: Locator; first: Locator; second: Locator }

function formIn(dialog: Locator): Form {
    return {
        dialog,
        region: dialog.getByRole('combobox', { name: 'Region', exact: true }),
        ruleset: dialog.getByRole('radiogroup', { name: 'Ruleset' }),
        first: dialog.getByRole('textbox', { name: 'First name', exact: true }),
        second: dialog.getByRole('textbox', { name: 'Second name', exact: true }),
    };
}

/** Open Add Character on the profile page and pick WoW: Forever from the search. */
async function openForeverAdd(page: Page): Promise<Form> {
    await page.goto('/profile/gaming/characters');
    await page.getByRole('button', { name: 'Add Character' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add Character' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const game = dialog.getByRole('combobox', { name: 'Game', exact: true });
    const settled = page.waitForResponse((r) => {
        const url = new URL(r.url());
        return url.pathname.endsWith('/games/search') && url.searchParams.get('q') === GAME_NAME && r.ok();
    }, { timeout: 20_000 });
    await game.click();
    await game.pressSequentially(GAME_NAME, { delay: 20 });
    await settled;
    await page.getByRole('listbox').getByRole('option', { name: GAME_NAME, exact: true }).click();
    await expect(game).toHaveValue(GAME_NAME);
    const form = formIn(dialog);
    await expect(form.first, 'picking Forever should show the First name field').toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true }), 'Forever replaces the Name field').toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: 'Realm/Server' }), 'Forever has no realm').toHaveCount(0);
    return form;
}

async function pickRuleset(form: Form, label: string): Promise<void> {
    await form.ruleset.getByText(label, { exact: true }).click();
    await expect(form.ruleset.getByRole('radio', { name: label })).toBeChecked();
}

async function submit(form: Form, label: 'Add Character' | 'Save Changes'): Promise<void> {
    await form.dialog.getByTestId('modal-footer').getByRole('button', { name: label, exact: true }).click();
}

/** Phone: the pairs stack one per row and nothing scrolls sideways. Wider: two-up. */
async function expectFieldLayout(page: Page, form: Form, testInfo: TestInfo): Promise<void> {
    const a = await form.first.boundingBox();
    const b = await form.second.boundingBox();
    if (!a || !b) throw new Error('the First/Second name inputs should have bounding boxes');
    if (isMobile(testInfo)) {
        expect(b.y, 'on a phone Second name should sit below First name').toBeGreaterThanOrEqual(a.y + a.height);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'the page should not scroll horizontally on a phone').toBeLessThanOrEqual(0);
    } else {
        expect(Math.abs(b.y - a.y), 'from 640px First and Second name sit side by side').toBeLessThan(2);
    }
}

test.describe('WoW: Forever manual characters (ROK-1721)', () => {
    test.beforeAll(async () => {
        const token = await getAdminToken();
        const game = (await apiGet(token, `/games/slug/${GAME_SLUG}`)) as { id?: number } | null;
        gameId = game?.id ?? null;
    });

    test.beforeEach(() => {
        test.skip(gameId === null, `"${GAME_SLUG}" is not in this env (boot seed seed-games.data.ts did not run)`);
    });

    test('add: region, ruleset, two-part name and preview; detail page shows the ruleset', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        const name = uniqueName(testInfo, 'Smokeadd');
        try {
            const form = await openForeverAdd(page);
            await form.region.selectOption('eu');
            await pickRuleset(form, 'PvP');
            await form.first.fill(name.first);
            await form.second.fill(name.second);
            await expect(form.dialog.getByText(`Shown in-game as “${name.full}”`)).toBeVisible();
            await expectFieldLayout(page, form, testInfo);
            await submit(form, 'Add Character');
            await expect(form.dialog, 'a valid Forever character should save and close the modal').toHaveCount(0);
            const saved = await waitForCharacter(token, name.full);
            expect({ region: saved.region, ruleset: saved.ruleset }).toEqual({ region: 'eu', ruleset: 'pvp' });
            await expect(page.getByText(name.full, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
            await page.goto(`/characters/${saved.id}`);
            await expect(page.getByRole('heading', { name: name.full })).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText('PvP (EU)', { exact: true }).first(), 'the ruleset + region sits where a realm would').toBeVisible();
        } finally {
            await deleteByName(token, name.full);
        }
    });

    test('a one-word name blocks save with "Enter a first and second name"', async ({ page }) => {
        const posts: string[] = [];
        page.on('request', (r) => {
            if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/users/me/characters')) posts.push(r.url());
        });
        const form = await openForeverAdd(page);
        await form.first.fill('Solo');
        await submit(form, 'Add Character');
        await expect(form.dialog.getByRole('alert').filter({ hasText: 'Enter a first and second name' })).toBeVisible();
        await expect(form.dialog, 'an invalid name keeps the modal open').toBeVisible();
        expect(posts, 'a one-word name must never reach the API').toHaveLength(0);
    });

    test('a Region + name another player holds shows the 409 claim copy', async ({ page }, testInfo) => {
        const adminToken = await getAdminToken();
        const otherToken = await getInviteeToken();
        const name = uniqueName(testInfo, 'Smokeclaim');
        try {
            await createViaApi(otherToken, name.full, 'us');
            const form = await openForeverAdd(page);
            await form.region.selectOption('us');
            // Typed lowercase: the 409 names the character as stored, not as typed.
            await form.first.fill(name.first.toLowerCase());
            await form.second.fill(name.second.toLowerCase());
            await submit(form, 'Add Character');
            const claimed = `${name.full} (US) is already claimed by another player`;
            await expect(
                form.dialog.getByRole('alert').filter({ hasText: claimed }),
                'the other player\'s claim should surface as the 409 copy',
            ).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText(claimed), 'the 409 shows once — inline, with no duplicate toast').toHaveCount(1);
            await expect(form.dialog, 'a rejected claim keeps the modal open').toBeVisible();
        } finally {
            await deleteByName(otherToken, name.full);
            await deleteByName(adminToken, name.full);
        }
    });

    test('edit keeps Region read-only and saves a ruleset change', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        const name = uniqueName(testInfo, 'Smokeedit');
        try {
            await createViaApi(token, name.full, 'us');
            const form = await openEdit(page, name.full);
            await expect(form.region, 'Region is part of the identity and cannot change').toBeDisabled();
            await expect(form.region).toHaveValue('us');
            await expect(form.dialog.getByText("Region can't be changed after creation")).toBeVisible();
            await expect(form.first).toHaveValue(name.first);
            await expect(form.second).toHaveValue(name.second);
            await pickRuleset(form, 'Roleplaying');
            await submit(form, 'Save Changes');
            await expect(form.dialog).toHaveCount(0);
            await pollForCondition(
                async () => (await listForever(token)).find((c) => c.name === name.full && c.ruleset === 'roleplaying') ?? null,
                { timeoutMs: 15_000, description: `"${name.full}" saved as roleplaying` },
            );
            const after = await waitForCharacter(token, name.full);
            expect(after.region, 'an edit must never move the character to another region').toBe('us');
        } finally {
            await deleteByName(token, name.full);
        }
    });
});

/**
 * Open Edit for the card named `fullName` (kebab menu on phones, inline button wider).
 * The kebab is `md:hidden` and the inline actions `hidden md:flex`, and role locators skip
 * display:none, so the card is anchored on whichever of the two this breakpoint renders.
 */
async function openEdit(page: Page, fullName: string): Promise<Form> {
    await page.goto('/profile/gaming/characters');
    const card = page.locator('div')
        .filter({ has: page.getByText(fullName, { exact: true }) })
        .filter({ has: page.getByRole('button', { name: /^(Character actions|Edit)$/ }) })
        .last();
    await expect(card, `the "${fullName}" card should be listed`).toBeVisible({ timeout: 15_000 });
    const kebab = card.getByRole('button', { name: 'Character actions' });
    if (await kebab.isVisible()) {
        // Below md the inline actions are hidden, so the only visible Edit is the opened panel's.
        await kebab.click();
        await page.getByRole('button', { name: 'Edit', exact: true }).filter({ visible: true }).first().click();
    } else {
        await card.getByRole('button', { name: 'Edit', exact: true }).click();
    }
    const dialog = page.getByRole('dialog', { name: 'Edit Character' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    return formIn(dialog);
}
