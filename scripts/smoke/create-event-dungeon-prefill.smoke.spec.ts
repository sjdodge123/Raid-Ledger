/**
 * ROK-2215 — Create Event from a dungeon-plan link:
 * `/events/new?gameId&guildId&contentInstanceIds&inviteCharacterIds`.
 *
 * P1 — `contentInstanceIds=<raid>,<dungeon>` opens the form with the Forever
 *      dungeon selected as a content-browser chip (the raid id is dropped) and
 *      the Dungeon event type auto-picked; no invite line without invite ids.
 * P2 — `inviteCharacterIds=<gm char>,<member char>` shows "Will invite: <A>, <B>";
 *      after create the page lands on `/events/:id`, the browser posts both ids
 *      to `POST /events/:id/invite-characters` (201, both invited), and each
 *      owner gets exactly one `new_event` notification for that event (polled).
 * P3 — "Don't invite" clears the line, and the create sends no invite request.
 *
 * Fixtures: `POST /admin/test/wow/seed-guild` (ROK-1785; Forever by default,
 * activates the `blizzard` plugin the page gates on) with a per-project,
 * per-worker, per-run name; its gm/member users own claimed characters with
 * linked (`smoke-guild-…`) Discord ids. The Forever dungeon/raid lists are the
 * static ROK-2210 catalogue (`GET /blizzard/instances`) — no Blizzard keys
 * needed, so `/system/status` is not patched. Notifications are read through
 * `GET /admin/test/notifications`. Seeded users and created events are
 * deleted in `finally`.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';

/** Character names of the seed-guild roster rows owned by gm / member (`SEED_GUILD_ROSTER`). */
const GM_CHAR = 'Aldren';
const MEMBER_CHAR = 'Dainel';

interface SeededUser { userId: number; characterId: string | null }
interface SeededGuild { guildId: number; gameId: number; users: { gm: SeededUser; member: SeededUser } }
interface Instance { id: number; name: string }
interface Plan { guild: SeededGuild; dungeon: Instance; raid: Instance; invitees: [string, string] }
interface Notification { type?: unknown; payload?: { eventId?: unknown } | null }
interface InviteResult { invited?: Array<{ characterId?: unknown }>; skipped?: unknown[] }

function guildName(testInfo: TestInfo): string {
    return `Plan ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo) })) as Partial<SeededGuild> | null;
    if (typeof body?.guildId !== 'number' || typeof body.gameId !== 'number' || !body.users?.gm || !body.users.member) {
        throw new Error(`[create-event-dungeon-prefill] seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, gameId: body.gameId, users: body.users };
}

/** The first Forever dungeon or raid of the static catalogue. */
async function firstInstance(token: string, type: 'dungeon' | 'raid'): Promise<Instance> {
    const res = (await apiGet(token, `/blizzard/instances?gameVariant=wow_forever&type=${type}`)) as { data?: Instance[] } | null;
    const first = res?.data?.[0];
    if (!first || typeof first.id !== 'number' || typeof first.name !== 'string') {
        throw new Error(`[create-event-dungeon-prefill] no Forever ${type} in the catalogue: ${JSON.stringify(res).slice(0, 200)}`);
    }
    return first;
}

function characterOf(user: SeededUser, role: string): string {
    if (!user.characterId) throw new Error(`[create-event-dungeon-prefill] seeded ${role} has no character`);
    return user.characterId;
}

async function seedPlan(token: string, testInfo: TestInfo): Promise<Plan> {
    const guild = await seedGuild(token, testInfo);
    const [dungeon, raid] = await Promise.all([firstInstance(token, 'dungeon'), firstInstance(token, 'raid')]);
    const invitees: [string, string] = [characterOf(guild.users.gm, 'gm'), characterOf(guild.users.member, 'member')];
    return { guild, dungeon, raid, invitees };
}

async function cleanup(token: string, plan: Plan | null, eventIds: number[]): Promise<void> {
    for (const id of eventIds) await apiDelete(token, `/events/${id}`).catch(() => undefined);
    if (!plan) return;
    for (const user of Object.values(plan.guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

/** Opens the plan link and waits past the dungeon-list spinner to the form. */
async function openPlanLink(page: Page, plan: Plan, params: Record<string, string>): Promise<void> {
    const qs = new URLSearchParams({ gameId: String(plan.guild.gameId), guildId: String(plan.guild.guildId), ...params });
    await page.goto(`/events/new?${qs}`);
    await expect(page.getByRole('heading', { name: 'Create Event', level: 1 })).toBeVisible({ timeout: 20_000 });
}

/** Fills the required fields, submits, and returns the new event id (claimed before any assertion). */
async function submitEvent(page: Page, title: string, eventIds: number[]): Promise<number> {
    await page.getByRole('textbox', { name: 'Event Title' }).fill(title);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await page.getByRole('textbox', { name: 'Date' }).fill(tomorrow);
    await page.getByRole('textbox', { name: 'Start Time' }).fill('20:00');
    await page.getByRole('radio', { name: '2h', exact: true }).locator('xpath=..').click();
    await page.getByRole('button', { name: 'Create Event' }).click();
    await page.waitForURL(/\/events\/\d+/, { timeout: 20_000 });
    const eventId = Number(page.url().match(/\/events\/(\d+)/)?.[1]);
    if (Number.isInteger(eventId) && eventId > 0) eventIds.push(eventId);
    expect(eventId, 'create lands on /events/:id').toBeGreaterThan(0);
    return eventId;
}

function isInviteCall(r: { url(): string }): boolean {
    return /\/events\/\d+\/invite-characters$/.test(new URL(r.url()).pathname);
}

/** Polls until the user holds a `new_event` notification for the event; returns how many. */
async function waitForInviteNotification(token: string, userId: number, eventId: number): Promise<number> {
    return pollForCondition(async () => {
        const rows = (await apiGet(token, `/admin/test/notifications?userId=${userId}&type=new_event&limit=50`)) as Notification[] | null;
        const forEvent = (rows ?? []).filter((n) => n.payload?.eventId === eventId).length;
        return forEvent > 0 ? { forEvent } : null;
    }, { timeoutMs: 20_000, description: `new_event notification for user ${userId} on event ${eventId}` }).then((r) => r.forEvent);
}

test.describe('Create Event — dungeon-plan pre-fill and planned-character invites (ROK-2215)', () => {
    test('P1: the plan dungeon is pre-selected as a chip and the Dungeon event type is auto-picked; a raid id is dropped', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        let plan: Plan | null = null;
        try {
            plan = await seedPlan(token, testInfo);
            await openPlanLink(page, plan, { contentInstanceIds: `${plan.raid.id},${plan.dungeon.id}` });
            await expect(page.getByRole('button', { name: `Remove ${plan.dungeon.name}` }), `AC1: the "${plan.dungeon.name}" chip is pre-selected`)
                .toBeVisible({ timeout: 15_000 });
            await expect(page.getByRole('button', { name: `Remove ${plan.raid.name}` }), 'AC1: a raid id in the plan is dropped').toHaveCount(0);
            await expect(page.getByLabel('Event Type').locator('option:checked'), 'AC1: the Dungeon event type is auto-picked')
                .toHaveText(/Dungeon/, { timeout: 10_000 });
            await expect(page.getByTestId('invite-preview-line'), 'no invite ids → no invite line').toHaveCount(0);
        } finally {
            await cleanup(token, plan, []);
        }
    });

    test('P2: "Will invite" names the planned characters, and create invites each owner once', async ({ page, world }, testInfo) => {
        const token = await getAdminToken();
        let plan: Plan | null = null;
        const eventIds: number[] = [];
        try {
            plan = await seedPlan(token, testInfo);
            await openPlanLink(page, plan, { contentInstanceIds: String(plan.dungeon.id), inviteCharacterIds: plan.invitees.join(',') });
            await expect(page.getByTestId('invite-preview-line'), 'AC2: the invite line names both planned characters')
                .toContainText(`Will invite: ${GM_CHAR}, ${MEMBER_CHAR}`, { timeout: 15_000 });
            const inviteResponse = page.waitForResponse((r) => r.request().method() === 'POST' && isInviteCall(r), { timeout: 20_000 });
            const eventId = await submitEvent(page, world.uid('plan-invite'), eventIds);
            const response = await inviteResponse;
            expect(new URL(response.url()).pathname, 'AC3: the invite call targets the new event').toMatch(new RegExp(`/events/${eventId}/invite-characters$`));
            expect(response.request().postDataJSON(), 'AC3: the browser posts exactly the planned ids').toEqual({ characterIds: plan.invitees });
            expect(response.status(), 'AC3: invite-characters answers 201').toBe(201);
            const result = (await response.json()) as InviteResult;
            expect((result.invited ?? []).map((i) => i.characterId).sort(), 'AC3: both linked owners are invited').toEqual([...plan.invitees].sort());
            for (const user of [plan.guild.users.gm, plan.guild.users.member]) {
                const count = await waitForInviteNotification(token, user.userId, eventId);
                expect(count, `AC3: user ${user.userId} is invited exactly once`).toBe(1);
            }
        } finally {
            await cleanup(token, plan, eventIds);
        }
    });

    test('P3: "Don\'t invite" clears the line and the create sends no invite request', async ({ page, world }, testInfo) => {
        const token = await getAdminToken();
        let plan: Plan | null = null;
        const eventIds: number[] = [];
        const inviteCalls: string[] = [];
        page.on('request', (req) => { if (isInviteCall(req)) inviteCalls.push(req.url()); });
        try {
            plan = await seedPlan(token, testInfo);
            await openPlanLink(page, plan, { contentInstanceIds: String(plan.dungeon.id), inviteCharacterIds: plan.invitees.join(',') });
            const line = page.getByTestId('invite-preview-line');
            await expect(line).toBeVisible({ timeout: 15_000 });
            await line.getByRole('button', { name: "Don't invite" }).click();
            await expect(line, '"Don\'t invite" removes the line').toHaveCount(0);
            const title = world.uid('plan-no-invite');
            await submitEvent(page, title, eventIds);
            // The invite call is issued in the create mutation's onSuccess, before navigate —
            // so once the detail page renders it would already have been sent.
            await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
            expect(inviteCalls, 'no invite-characters request after "Don\'t invite"').toEqual([]);
        } finally {
            await cleanup(token, plan, eventIds);
        }
    });
});
