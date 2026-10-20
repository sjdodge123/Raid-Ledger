/**
 * ROK-1868 — shared drivers for the hub-post markdown editor (TipTap) used by
 * `hub-posts.smoke.spec.ts` and `guild-content.smoke.spec.ts`.
 *
 * The editor is a lazy chunk: `md-editor-loading` shows until it resolves,
 * then the frame (`data-testid` = the caller's testId) holds a `Formatting`
 * toolbar (`md-tool-<key>`), the optional link row (`md-link-row`) and the
 * ProseMirror content (`role="textbox"`).
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

export type Role = 'gm' | 'officer' | 'member' | 'outsider';

export interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number; characterId: string | null }>;
    /** The three seeded hub posts, newest first. */
    postIds: number[];
}

/** A guild name unique to this project, worker and run (fixture: 3-48 chars). */
export function uniqueGuildName(prefix: string, testInfo: TestInfo): string {
    return `${prefix} ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedContentGuild(token: string, name: string): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name, withContent: true })) as
        Partial<SeededGuild> & { content?: { addonIds?: number[]; postIds?: number[] } };
    const postIds = body.content?.postIds;
    if (typeof body.guildId !== 'number' || !body.users || body.content?.addonIds?.length !== 2 || postIds?.length !== 3) {
        throw new Error(`seed-guild withContent: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users, postIds };
}

/** Seed a content guild (3 hub posts), run `body`, and always delete the seeded users. */
export async function withContentGuild(
    prefix: string,
    testInfo: TestInfo,
    body: (guild: SeededGuild) => Promise<void>,
): Promise<void> {
    const token = await getAdminToken();
    const guild = await seedContentGuild(token, uniqueGuildName(prefix, testInfo));
    try {
        await body(guild);
    } finally {
        for (const user of Object.values(guild.users)) {
            await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    }
}

export async function openGuildAs(page: Page, guild: SeededGuild, role: Role, suffix = ''): Promise<void> {
    await signInOnboardedMember(page, guild.users[role].userId);
    await page.goto(`/guilds/${guild.guildId}${suffix}`);
}

/** Wait for the lazy editor chunk inside `frame`; return its contenteditable. */
export async function editorTextbox(page: Page, frame: Locator): Promise<Locator> {
    await expect(page.getByTestId('md-editor-loading'), 'the lazy editor chunk resolves').toHaveCount(0, { timeout: 15_000 });
    const box = frame.locator('[role="textbox"][contenteditable="true"]');
    await expect(box).toBeVisible();
    return box;
}

export function tool(frame: Locator, key: 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'bullets' | 'numbers'): Locator {
    return frame.getByTestId(`md-tool-${key}`);
}

/** Type `text` and make it bold with the toolbar, leaving the cursor after it with bold OFF. */
export async function typeBoldLine(page: Page, frame: Locator, text: string): Promise<void> {
    await page.keyboard.type(text);
    await page.keyboard.press('Shift+Home');
    await tool(frame, 'bold').click();
    await expect(tool(frame, 'bold')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('End');
    // Bold is still the stored mark at the end of the run; switch it off so the next line is plain.
    await tool(frame, 'bold').click();
    await expect(tool(frame, 'bold')).toHaveAttribute('aria-pressed', 'false');
}

/** Open the link row, enter `address`, Apply; the row closes. */
export async function insertLinkViaRow(frame: Locator, address: string): Promise<void> {
    await tool(frame, 'link').click();
    const row = frame.getByTestId('md-link-row');
    await row.getByLabel('Link address').fill(address);
    await row.getByRole('button', { name: 'Apply' }).click();
    await expect(row).toHaveCount(0);
}
