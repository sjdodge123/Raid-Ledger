/**
 * ROK-1968 §8.5 — the hub Overview "Before next session" card (Core widget
 * `session-note`, `#hub-widget-core-session-note`): desktop, mobile AND tablet.
 *
 * Every test re-seeds through the DEMO_MODE fixture
 * `POST /admin/test/community-hubs/seed {gameId, withEvent: true}`: "Seed Crew"
 * (leader + officer + 4 members) is recreated with a NEW id — so its note
 * starts empty — plus one upcoming event tagged to it (`hubEvent`), which the
 * editor's "Clear after the next event" checkbox pins. Each project seeds a
 * DIFFERENT configured game (the seed clears by game) offset from the games
 * the other hub specs use (community-hubs `slot`, hubs-nav `3 + slot`,
 * hub-poll `6 + slot`; this spec `9 + slot`).
 *
 *  T-P1 Admin: the editor hint → Add note → body + 2 items + clear-after →
 *       Save → the card shows the body, both items, "Edited by" and "Clears after".
 *  T-P2 Member: the card is visible with no Edit control; ticking item 1
 *       survives a reload.
 *  T-P3 Admin: Edit → Clear note → confirm → the hint returns.
 *
 * Every write is confirmed by polling the API — the first render is never
 * trusted (memory `feedback_smoke_polling_for_async_writes`).
 */
import type { Locator, Page, Response, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPut, getAdminToken } from './api-helpers';
import { seedCommunityHubs } from './hub-seed';
import { signInAsAdmin, signInOnboardedMember } from './browser-session';
import { editorTextbox } from './hub-post-editor';

interface Seed {
    gameId: number;
    hubIds: { crew: number; solo: number; archived: number };
    /** `[officer, member-1, member-2, member-3, member-4]`. */
    memberUserIds: number[];
    hubEvent: { id: number; title: string; startTime: string };
}

interface NoteItem { id: number; text: string; done: boolean }

interface NoteResponse {
    note: {
        body: string;
        items: NoteItem[];
        updatedBy: { displayName: string } | null;
        clearAfter: { eventId: number; title: string } | null;
    } | null;
    viewer: { canEdit: boolean; canTick: boolean };
}

const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };
const GAME_OFFSET = 9;
const BODY = 'Bring flasks and repair before the pull.';
const ITEMS = ['Bring 20 flasks', 'Repair gear'] as const;

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[hub-session-note] missing ${label}`);
    return value;
}

function slotOf(testInfo: TestInfo): number {
    return PROJECT_SLOT[testInfo.project.name] ?? 0;
}

async function projectGameId(token: string, testInfo: TestInfo): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = raw
        .map((g) => (g as { id?: unknown }).id)
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => a - b);
    if (ids.length === 0) throw new Error('[hub-session-note] GET /games/configured returned no games');
    return must(ids[(GAME_OFFSET + slotOf(testInfo)) % ids.length], 'project game');
}

async function seedHub(testInfo: TestInfo): Promise<{ seed: Seed; admin: string }> {
    const admin = await getAdminToken();
    const gameId = await projectGameId(admin, testInfo);
    const body = (await seedCommunityHubs(admin, testInfo, 'hub-session-note', { gameId, withEvent: true })) as Partial<Seed> | null;
    if (!body?.hubIds || !Array.isArray(body.memberUserIds) || typeof body.hubEvent?.id !== 'number') {
        throw new Error(`[hub-session-note] seed: ${JSON.stringify(body)}`);
    }
    return { seed: body as Seed, admin };
}

/** This project's crew member: member-1 / member-2 / member-3. */
function memberId(seed: Seed, testInfo: TestInfo): number {
    return must(seed.memberUserIds[1 + slotOf(testInfo)], 'crew member id');
}

async function noteOf(jwt: string, hubId: number): Promise<NoteResponse> {
    return must((await apiGet(jwt, `/guilds/${hubId}/session-note`)) as NoteResponse | null, `GET /guilds/${hubId}/session-note`);
}

/** A two-item note saved through the API by `admin`; returns its items once the GET reports them. */
async function putNote(admin: string, hubId: number): Promise<NoteItem[]> {
    const res = (await apiPut(admin, `/guilds/${hubId}/session-note`, {
        body: BODY,
        items: ITEMS.map((text) => ({ text })),
        clearAfterNextEvent: false,
        baseUpdatedAt: null,
    })) as Partial<NoteResponse> | null;
    if (!res?.note) throw new Error(`[hub-session-note] PUT note: ${JSON.stringify(res)}`);
    await expect.poll(async () => (await noteOf(admin, hubId)).note?.items.length, {
        message: 'the seeded note must reach GET /guilds/:id/session-note',
    }).toBe(ITEMS.length);
    return must((await noteOf(admin, hubId)).note, 'seeded note').items;
}

function noteWrite(page: Page, hubId: number, method: string): Promise<Response> {
    return page.waitForResponse(
        (r) => r.request().method() === method && new URL(r.url()).pathname.includes(`/guilds/${hubId}/session-note`),
        { timeout: 20_000 },
    );
}

const card = (page: Page): Locator => page.locator('#hub-widget-core-session-note');

async function openOverview(page: Page, hubId: number): Promise<void> {
    const loaded = page.waitForResponse(
        (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/guilds/${hubId}/session-note`),
        { timeout: 20_000 },
    );
    await page.goto(`/hubs/${hubId}`);
    expect((await loaded).status(), 'GET /guilds/:id/session-note').toBe(200);
}

/** Opens the editor from the empty card's hint (T-P1) or the card's Edit action (T-P3). */
async function openEditor(page: Page, trigger: 'session-note-add' | 'session-note-edit'): Promise<Locator> {
    await card(page).getByTestId(trigger).click();
    const form = page.getByTestId('session-note-form');
    await expect(form, 'the editor dialog opens').toBeVisible({ timeout: 15_000 });
    return form;
}

async function fillNewNote(page: Page, form: Locator, eventTitle: string): Promise<void> {
    const box = await editorTextbox(page, form.getByTestId('session-note-body-input'));
    await box.click();
    await page.keyboard.type(BODY);
    for (const [index, text] of ITEMS.entries()) {
        await form.getByTestId('session-note-add-item').click();
        await form.getByTestId(`session-note-item-input-${index}`).fill(text);
    }
    await expect(form.getByTestId('session-note-clear-after-hint'), 'the checkbox names the hub\'s next event')
        .toContainText(eventTitle);
    const toggle = form.getByTestId('session-note-clear-after-checkbox');
    await expect(toggle, 'a new note starts with clear-after OFF').not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
}

test.describe('hub "Before next session" note (ROK-1968)', () => {
    test('T-P1 admin: hint → Add note → body + 2 items + clear-after → Save → the card shows it', async ({ page }, testInfo) => {
        const { seed, admin } = await seedHub(testInfo);
        const hubId = seed.hubIds.crew;
        expect((await noteOf(admin, hubId)).note, 'a freshly seeded hub has no note').toBeNull();
        await signInAsAdmin(page.context());
        await openOverview(page, hubId);

        const hint = card(page).getByTestId('session-note-hint');
        await expect(hint, 'an editor sees the empty card\'s hint').toBeVisible({ timeout: 15_000 });
        await expect(hint).toContainText('Add a note for next session');
        const form = await openEditor(page, 'session-note-add');
        await fillNewNote(page, form, seed.hubEvent.title);

        const saved = noteWrite(page, hubId, 'PUT');
        await page.getByTestId('session-note-save').click();
        expect((await saved).status(), 'PUT /guilds/:id/session-note').toBe(200);
        await expect(form, 'a successful save closes the editor').toBeHidden({ timeout: 15_000 });

        await expect.poll(async () => {
            const note = (await noteOf(admin, hubId)).note;
            return note && { body: note.body.trim(), items: note.items.map((i) => i.text), pin: note.clearAfter?.eventId ?? null };
        }, { message: 'the saved note must reach the API, pinned to the seeded event' })
            .toEqual({ body: BODY, items: [...ITEMS], pin: seed.hubEvent.id });
        const editor = must((await noteOf(admin, hubId)).note?.updatedBy?.displayName, 'updatedBy.displayName');

        await expect(card(page).getByTestId('session-note-body'), 'the card renders the body').toContainText(BODY, { timeout: 15_000 });
        for (const text of ITEMS) {
            await expect(card(page).getByRole('checkbox', { name: text }), `the card lists "${text}"`).toBeVisible();
        }
        await expect(card(page).getByText(`Edited by ${editor}`), 'the footer names the editor').toBeVisible();
        await expect(card(page).getByTestId('session-note-clear-after'), 'the footer names the pinned event')
            .toContainText(seed.hubEvent.title);
        await expect(card(page).getByTestId('session-note-hint'), 'the hint is gone once a note exists').toHaveCount(0);
    });

    test('T-P2 member: card visible, no Edit; ticking item 1 survives a reload', async ({ page }, testInfo) => {
        const { seed, admin } = await seedHub(testInfo);
        const hubId = seed.hubIds.crew;
        const items = await putNote(admin, hubId);
        const first = must(items[0], 'item 1');
        const jwt = await signInOnboardedMember(page, memberId(seed, testInfo));
        expect((await noteOf(jwt, hubId)).viewer, 'a crew member ticks but does not edit').toEqual({ canEdit: false, canTick: true });

        await openOverview(page, hubId);
        await expect(card(page).getByTestId('session-note-body'), 'a member sees the note').toContainText(BODY, { timeout: 15_000 });
        await expect(card(page).getByTestId('session-note-edit'), 'a member has no Edit control').toHaveCount(0);
        await expect(card(page).getByTestId('session-note-add')).toHaveCount(0);

        const box = card(page).getByTestId(`session-note-item-${first.id}`);
        await expect(box).toBeEnabled();
        await expect(box).not.toBeChecked();
        const ticked = noteWrite(page, hubId, 'PATCH');
        await box.check();
        expect((await ticked).status(), 'PATCH /guilds/:id/session-note/items/:itemId').toBe(200);
        await expect.poll(async () => (await noteOf(jwt, hubId)).note?.items.find((i) => i.id === first.id)?.done, {
            message: 'the tick must reach the API',
        }).toBe(true);

        await openOverview(page, hubId);
        await expect(card(page).getByTestId(`session-note-item-${first.id}`), 'the tick survives a reload')
            .toBeChecked({ timeout: 15_000 });
        const second = must(items[1], 'item 2');
        await expect(card(page).getByTestId(`session-note-item-${second.id}`), 'item 2 is untouched').not.toBeChecked();
    });

    test('T-P3 admin: Edit → Clear note → confirm → the hint returns', async ({ page }, testInfo) => {
        const { seed, admin } = await seedHub(testInfo);
        const hubId = seed.hubIds.crew;
        await putNote(admin, hubId);
        await signInAsAdmin(page.context());
        await openOverview(page, hubId);
        await expect(card(page).getByTestId('session-note-body')).toContainText(BODY, { timeout: 15_000 });

        await openEditor(page, 'session-note-edit');
        await page.getByTestId('session-note-clear').click();
        const confirm = page.getByTestId('discard-changes-confirm');
        await expect(confirm, 'Clear note asks first').toBeVisible();
        await expect(page.getByText('Clear the note for everyone?')).toBeVisible();
        const cleared = noteWrite(page, hubId, 'DELETE');
        await confirm.getByTestId('discard-changes-discard').click();
        expect((await cleared).status(), 'DELETE /guilds/:id/session-note').toBe(204);

        await expect.poll(async () => (await noteOf(admin, hubId)).note, { message: 'the clear must reach the API' }).toBeNull();
        await expect(page.getByTestId('session-note-form'), 'the editor closes after clearing').toBeHidden({ timeout: 15_000 });
        await expect(card(page).getByTestId('session-note-hint'), 'the empty card\'s hint returns').toBeVisible({ timeout: 15_000 });
        await expect(card(page).getByTestId('session-note-body')).toHaveCount(0);
    });
});
