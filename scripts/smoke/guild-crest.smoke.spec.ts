/**
 * Guild crest smoke (ROK-1814) — desktop AND mobile.
 *
 * Each test seeds its OWN guild through the DEMO_MODE fixture
 * `POST /admin/test/wow/seed-guild` (unique per project, worker and run), so
 * the parallel projects never share a crest. The officer is an editor granted
 * by name (`viewer.canEdit`), which is what adds the pencil badge
 * (`hub-crest-edit`, "Change crest" — the ONLY picker entry since ROK-2074);
 * the plain member gets the read-only crest.
 *
 * ROK-2074: a crest with a picture is a "View hub picture" button for
 * everyone. A crest picked from the Gallery opens that picture in the Gallery
 * viewer; an uploaded crest opens the single-picture viewer titled "Picture";
 * a preset is not a button. Escape closes either and focus returns to the crest.
 *
 * The picker is a `Modal` at ≥1024px and a `BottomSheet` below — both carry
 * the same test ids. Its radios are `sr-only` inputs inside `<label>`s, so the
 * spec clicks the label and asserts the input's checked state. After each
 * save the spec polls `GET /guilds/:id/crest` (the source of truth) before
 * asserting the hero, so a stale query cache cannot mask a failed write.
 * The upload test picks the committed 96×96 fixture PNG (the API's floor is
 * 64×64); the file is only staged until Save commits it.
 */
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, apiPut, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { pollListed, uniquePng, uploadAs } from './hub-gallery-upload-fixtures';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number }>;
}

interface CrestEditorState {
    active: 'upload' | 'preset' | null;
    preset: { emblemId: string; fg: string; bg: string } | null;
}

/** A guild name unique to this project, worker and run (fixture: 3-48 chars). */
function guildName(testInfo: TestInfo): string {
    return `Crest ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

/** Seed a guild, run `body`, and always delete the seeded users. */
async function withGuild(testInfo: TestInfo, body: (guild: SeededGuild, token: string) => Promise<void>): Promise<void> {
    const token = await getAdminToken();
    const seeded = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo) })) as Partial<SeededGuild>;
    if (typeof seeded.guildId !== 'number' || !seeded.users) throw new Error(`seed-guild: ${JSON.stringify(seeded)}`);
    const guild: SeededGuild = { guildId: seeded.guildId, users: seeded.users };
    try {
        await body(guild, token);
    } finally {
        for (const user of Object.values(guild.users)) {
            await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    }
}

/** Poll the editor state until `done` holds — the server-side proof of a save. */
async function waitForCrest(token: string, guildId: number, done: (s: CrestEditorState) => boolean, description: string): Promise<void> {
    await pollForCondition(async () => {
        const state = (await apiGet(token, `/guilds/${guildId}/crest`)) as CrestEditorState | null;
        return state && done(state) ? state : null;
    }, { description });
}

/**
 * The label wrapping the radio named `name` inside `scope` (the input itself is `sr-only`).
 * The `has` locator is evaluated RELATIVE to each label, so it must be page-rooted: a
 * `scope.getByRole(...)` would carry the scope's own selector and need it inside the label.
 */
function radioLabel(scope: Locator, name: string): Locator {
    return scope.locator('label').filter({ has: scope.page().getByRole('radio', { name, exact: true }) });
}

async function pick(scope: Locator, name: string): Promise<void> {
    await radioLabel(scope, name).click();
    await expect(scope.getByRole('radio', { name, exact: true })).toBeChecked();
}

async function openPicker(page: Page): Promise<Locator> {
    const edit = page.getByTestId('guild-hero').getByTestId('hub-crest-edit');
    await expect(edit, 'the pencil badge is the "Change crest" target').toHaveAccessibleName('Change crest');
    await edit.click();
    const picker = page.getByTestId('crest-picker');
    await expect(picker).toBeVisible({ timeout: 15_000 });
    return picker;
}

async function save(page: Page, picker: Locator): Promise<void> {
    await page.getByTestId('crest-picker-save').click();
    await expect(picker, 'a successful save closes the picker').toHaveCount(0);
}

/** Below this width the header Hubs menu gives way to the bottom bar's "Your hubs" sheet. */
const HEADER_HUBS_MIN_WIDTH = 768;
const CREST_FIXTURE = join(__dirname, 'fixtures', 'guild-crest-96.png');

/** The guild's row in the header Hubs menu (≥768px) or the phone "Your hubs" sheet. */
async function openNavRow(page: Page, guildId: number): Promise<Locator> {
    if ((page.viewportSize()?.width ?? 0) >= HEADER_HUBS_MIN_WIDTH) {
        const trigger = page.getByRole('navigation', { name: 'Main navigation' }).getByTestId('nav-hubs-menu-trigger');
        await expect(trigger).toBeVisible({ timeout: 15_000 });
        await trigger.click();
        return page.getByRole('menu', { name: 'Hubs' }).locator(`a[href="/hubs/${guildId}"]`);
    }
    const trigger = page.getByTestId('bottom-tab-bar').getByTestId('bottom-hubs-trigger');
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    return page.getByRole('dialog', { name: 'Your hubs' }).locator(`a[href="/hubs/${guildId}"]`);
}

function heroCrest(page: Page): Locator {
    return page.getByTestId('guild-hero').getByTestId('hub-crest');
}

/** ROK-2074 — the crest itself, a button only when the crest has a picture. */
function viewCrest(page: Page): Locator {
    return page.getByTestId('guild-hero').getByRole('button', { name: 'View hub picture', exact: true });
}

/** Escape closes the open picture dialog and focus goes back to the crest. */
async function closeAndExpectFocusBack(page: Page, dialog: Locator): Promise<void> {
    await page.keyboard.press('Escape');
    await expect(dialog, 'Escape closes the picture').toHaveCount(0);
    await expect(viewCrest(page), 'focus returns to the crest').toBeFocused();
}

/** Poll the hub page (`GET /guilds/:id`) until its `guild.crestMediaId` is `expected`. */
async function waitForCrestMediaId(jwt: string, guildId: number, expected: number | null): Promise<void> {
    await pollForCondition(async () => {
        const page = (await apiGet(jwt, `/guilds/${guildId}`)) as { guild?: { crestMediaId?: number | null } } | null;
        return page?.guild !== undefined && (page.guild.crestMediaId ?? null) === expected ? true : null;
    }, { description: `hub page crestMediaId = ${String(expected)}` });
}

test('editor: picks an emblem + colours, the hero shows it; None falls back to initials', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild, token) => {
        await signInOnboardedMember(page, guild.users.officer.userId);
        await page.goto(`/hubs/${guild.guildId}`);
        await expect(heroCrest(page), 'a new guild has no crest: initials').toHaveAttribute('data-crest', 'initials', { timeout: 15_000 });

        let picker = await openPicker(page);
        await expect(picker.getByRole('radio', { name: 'Emblem', exact: true }), 'a hub with no crest opens on Emblem').toBeChecked();
        await expect(page.getByTestId('crest-credit')).toBeVisible();
        await pick(page.getByTestId('crest-emblem-grid'), 'Wolf head');
        await pick(page.getByTestId('crest-fg-swatches'), 'Or');
        await pick(page.getByTestId('crest-bg-swatches'), 'Azure');
        await expect(page.getByTestId('crest-preset-preview').getByTestId('hub-crest-emblem').first()).toHaveAttribute('data-emblem', 'wolf-head');
        await save(page, picker);
        await waitForCrest(token, guild.guildId, (s) => s.active === 'preset' && s.preset?.emblemId === 'wolf-head' && s.preset.fg === 'or' && s.preset.bg === 'azure', 'crest preset saved');
        await expect(heroCrest(page)).toHaveAttribute('data-crest', 'preset');
        await expect(heroCrest(page).getByTestId('hub-crest-emblem')).toHaveAttribute('data-emblem', 'wolf-head');

        picker = await openPicker(page);
        await expect(picker.getByRole('radio', { name: 'Emblem', exact: true }), 'the picker reopens on what the hub shows').toBeChecked();
        await pick(picker, 'None');
        await save(page, picker);
        await waitForCrest(token, guild.guildId, (s) => s.active === null && s.preset?.emblemId === 'wolf-head', 'crest set to none (preset kept)');
        await expect(heroCrest(page), 'None falls back to the initials').toHaveAttribute('data-crest', 'initials');
    });
});

test('member: sees the saved crest but no "Change crest" button', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild, token) => {
        await apiPut(token, `/guilds/${guild.guildId}/crest`, { active: 'preset', preset: { emblemId: 'crown', fg: 'or', bg: 'sable' } });
        await waitForCrest(token, guild.guildId, (s) => s.active === 'preset' && s.preset?.emblemId === 'crown', 'staff crest saved');
        await signInOnboardedMember(page, guild.users.member.userId);
        await page.goto(`/hubs/${guild.guildId}`);
        await expect(heroCrest(page), 'members see the saved crest').toHaveAttribute('data-crest', 'preset', { timeout: 15_000 });
        await expect(heroCrest(page).getByTestId('hub-crest-emblem')).toHaveAttribute('data-emblem', 'crown');
        await expect(page.getByTestId('hub-crest-edit'), 'only editors get the picker entry').toHaveCount(0);
        await expect(page.getByTestId('hub-crest-view'), 'a preset crest has no picture to view').toHaveCount(0);

        const row = await openNavRow(page, guild.guildId);
        await expect(row, 'the nav lists the guild').toBeVisible({ timeout: 15_000 });
        await expect(row.getByTestId('hub-crest'), 'the nav row shows the crest, not the shield').toHaveAttribute('data-crest', 'preset');
        await expect(row.getByTestId('hub-crest-emblem')).toHaveAttribute('data-emblem', 'crown');
    });
});

test('editor: uploads a PNG, Save commits it, the hero shows the image crest; it opens as a single picture', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild, token) => {
        const jwt = await signInOnboardedMember(page, guild.users.officer.userId);
        await page.goto(`/hubs/${guild.guildId}`);
        await expect(heroCrest(page)).toHaveAttribute('data-crest', 'initials', { timeout: 15_000 });

        const picker = await openPicker(page);
        await pick(picker, 'Upload');
        await picker.getByTestId('crest-upload-input').setInputFiles(CREST_FIXTURE);
        await save(page, picker);
        await waitForCrest(token, guild.guildId, (s) => s.active === 'upload', 'crest upload saved');
        await expect(heroCrest(page), 'the hero shows the uploaded crest').toHaveAttribute('data-crest', 'upload', { timeout: 15_000 });
        await expect(heroCrest(page).getByTestId('hub-crest-img')).toHaveAttribute('src', /\/guild-crests\//);

        // ROK-2074: an uploaded crest (not from the Gallery) opens the single-picture viewer.
        await waitForCrestMediaId(jwt, guild.guildId, null);
        await viewCrest(page).click();
        const single = page.getByRole('dialog', { name: 'Picture' });
        await expect(single, 'an uploaded crest opens the "Picture" viewer').toBeVisible({ timeout: 15_000 });
        await expect(single.getByTestId('hub-gallery-single').getByRole('img'), 'the viewer shows the crest upload')
            .toHaveAttribute('src', /\/guild-crests\//, { timeout: 15_000 });
        await expect(single.getByTestId('hub-gallery-viewer'), 'not the Gallery list viewer').toHaveCount(0);
        await closeAndExpectFocusBack(page, single);
    });
});

test('editor: a crest picked from the Gallery opens that picture in the Gallery viewer', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild, token) => {
        const jwt = await signInOnboardedMember(page, guild.users.officer.userId);
        const { id: mediaId } = await uploadAs(jwt, guild.guildId, uniquePng(96));
        await pollListed(jwt, guild.guildId, mediaId, true);
        await page.goto(`/hubs/${guild.guildId}`);
        await expect(heroCrest(page)).toHaveAttribute('data-crest', 'initials', { timeout: 15_000 });

        const picker = await openPicker(page);
        await pick(picker, 'Gallery');
        const option = picker.getByTestId(`crest-gallery-option-${mediaId}`);
        await option.click();
        await expect(option, 'the uploaded picture is the picked crest').toHaveAttribute('aria-checked', 'true');
        await save(page, picker);
        await waitForCrest(token, guild.guildId, (s) => s.active === 'upload', 'crest picked from the gallery');
        await waitForCrestMediaId(jwt, guild.guildId, mediaId);

        await page.goto(`/hubs/${guild.guildId}`);
        await expect(heroCrest(page), 'the hero shows the gallery crest').toHaveAttribute('data-crest', 'upload', { timeout: 15_000 });
        await viewCrest(page).click();
        const gallery = page.getByRole('dialog', { name: 'Gallery' });
        await expect(gallery, 'a gallery crest opens the Gallery').toBeVisible({ timeout: 15_000 });
        await expect(gallery.getByTestId('hub-gallery-viewer'), 'the viewer opens on the crest\'s picture')
            .toHaveAttribute('data-media-id', String(mediaId), { timeout: 15_000 });
        await closeAndExpectFocusBack(page, gallery);
    });
});
