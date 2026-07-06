/**
 * Admin User Management — kick / ban moderation smoke tests (ROK-313).
 *
 * Drives the new rendered admin flow at /admin/settings/general/roles end to
 * end against the running dev env (Playwright storageState authenticates as the
 * admin `admin@local`):
 *   - a non-admin member's kebab (⋮) exposes Kick + Ban items;
 *   - the Kick modal shows the title, reason field, the (real-snowflake-gated)
 *     "Also kick from Discord server" checkbox, and the amber Kick button;
 *   - confirming Kick surfaces a success toast and the amber "Kicked" badge;
 *   - Unkick from the kebab clears the badge;
 *   - the signed-in admin's own row is "Protected" with no action menu.
 *
 * Fixture isolation: each project seeds its OWN throwaway member via the
 * DEMO_MODE-only `POST /admin/test/seed-non-guild-user` (unique username +
 * a syntactically-valid Discord snowflake, so the Discord-kick checkbox renders).
 * The member is deleted in afterAll, so the run is idempotent and never mutates
 * the shared invitee fixture or any seeded demo user's session. No sleeps —
 * every wait is a deterministic Playwright assertion.
 *
 * Runs on BOTH the desktop and mobile projects (playwright.config.ts).
 */
import { test, expect } from './base';
import { getAdminToken, apiGet, apiPost, apiDelete } from './api-helpers';

const ROLES_URL = '/admin/settings/general/roles';

test.describe('Admin User Management — moderation (ROK-313)', () => {
    let adminToken: string;
    let adminName: string;
    let memberId: number;
    let memberName: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        const me = await apiGet(adminToken, '/auth/me');
        adminName = me.username;
        const seeded = await apiPost(adminToken, '/admin/test/seed-non-guild-user');
        memberId = seeded.userId;
        const profile = await apiGet(adminToken, `/users/${memberId}/profile`);
        memberName = profile.data.username;
    });

    test.afterAll(async () => {
        // Delete the throwaway member so re-runs start clean (works whether or
        // not the last test left it kicked).
        if (memberId) await apiDelete(adminToken, `/users/${memberId}`);
    });

    test('kicks a member (Kicked badge appears) then unkicks (badge clears)', async ({ page }) => {
        await page.goto(ROLES_URL);
        await page.getByPlaceholder('Search users...').fill(memberName);
        // exact:true — usernames can collide with prod-clone data on substring.
        // .first() — the infinite list can render a transient pre-filter +
        // filtered frame during the search transition; every duplicate is the
        // SAME member, so first() targets the right row without strict-mode flake.
        await expect(page.getByText(memberName, { exact: true }).first()).toBeVisible();
        const kebab = page.getByRole('button', { name: `Actions for ${memberName}` }).first();

        // Kebab exposes Kick + Ban for an active, non-admin member.
        await kebab.click();
        await expect(page.getByRole('menuitem', { name: 'Kick user' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Ban user' })).toBeVisible();

        // Kick modal: title, reason field, real-snowflake Discord checkbox, amber Kick.
        await page.getByRole('menuitem', { name: 'Kick user' }).click();
        await expect(page.getByText(`Kick ${memberName}`, { exact: true })).toBeVisible();
        await expect(page.getByLabel(/Reason/)).toBeVisible();
        await expect(page.getByLabel(/Also kick from Discord server/)).toBeVisible();
        const confirmKick = page.getByRole('button', { name: 'Kick', exact: true });
        await expect(confirmKick).toBeVisible();

        // Confirm → success toast (fires first) + amber Kicked badge on the row.
        await confirmKick.click();
        await expect(page.getByText(`${memberName} kicked`, { exact: true })).toBeVisible();
        await expect(page.getByText('Kicked', { exact: true }).first()).toBeVisible();

        // Reopen the kebab → Unkick (direct-fire, no modal) → badge clears.
        await kebab.click();
        await page.getByRole('menuitem', { name: 'Unkick user' }).click();
        await expect(page.getByText('Kicked', { exact: true })).toHaveCount(0);
    });

    test('admin (self) row is Protected with no action menu', async ({ page }) => {
        await page.goto(ROLES_URL);
        await page.getByPlaceholder('Search users...').fill(adminName);
        // "Protected" is rendered only by an admin row's action cell (no role
        // dropdown, no kebab) — asserting it first guarantees the admin row has
        // loaded before we assert the kebab is absent. (The username itself is
        // ambiguous at page scope: the nav user-chip also shows it and is
        // hidden on mobile, so we key off the list-only "Protected" label.)
        await expect(page.getByText('Protected').first()).toBeVisible();
        await expect(page.getByRole('button', { name: `Actions for ${adminName}` })).toHaveCount(0);
    });
});
