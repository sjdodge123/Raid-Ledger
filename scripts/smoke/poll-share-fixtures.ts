/**
 * Seeding + context helpers for `poll-share-link.smoke.spec.ts` (ROK-1750).
 *
 * Not a spec file (`testMatch: /\.smoke\.spec\.ts$/`), so Playwright never
 * collects it as tests.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { STORAGE_STATE_PATH } from '../auth-paths';
import { API_BASE, apiGet, apiPost, getInviteeFixture, pollForCondition } from './api-helpers';
import { getFirstGameId } from './scheduling-poll-fixtures';

export interface PrivatePoll {
    lineupId: number;
    pollId: number;
    shareToken: string;
}

/** The poll page a share link lands on. */
export function pollPagePath(poll: Pick<PrivatePoll, 'lineupId' | 'pollId'>): string {
    return `/community-lineup/${poll.lineupId}/schedule/${poll.pollId}`;
}

/** Create a PRIVATE standalone poll as `token` (the response carries the share token). */
export async function seedPrivatePoll(token: string): Promise<PrivatePoll> {
    const gameId = await getFirstGameId(token);
    const res = await fetch(`${API_BASE}/scheduling-polls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gameId, visibility: 'private' }),
    });
    expect(res.status, 'creating a private poll').toBe(201);
    const body = (await res.json()) as { id: number; lineupId: number; visibility?: string; shareToken?: string | null };
    expect(body.visibility, 'the create response reports the poll as private').toBe('private');
    expect(body.shareToken, 'a private poll is created with a share token').toMatch(/^[A-Za-z0-9_-]{43}$/);
    return { lineupId: body.lineupId, pollId: body.id, shareToken: body.shareToken as string };
}

/** Suggest one future time as `token` (suggesting auto-votes YES); returns its slot id. */
export async function suggestTime(token: string, poll: PrivatePoll): Promise<number> {
    const when = new Date();
    when.setDate(when.getDate() + 3);
    when.setHours(20, 0, 0, 0);
    const suggested = (await apiPost(token, `/lineups/${poll.lineupId}/schedule/${poll.pollId}/suggest`, {
        proposedTime: when.toISOString(),
    })) as { id?: number; data?: { id?: number } } | null;
    const slotId = suggested?.data?.id ?? suggested?.id;
    expect(slotId, 'suggesting a time returns its slot id').toBeTruthy();
    return slotId as number;
}

/** Wait until `token` can read the poll page payload (useQuery staleTime barrier, ROK-1247). */
export async function waitForPollReadable(token: string, poll: PrivatePoll): Promise<void> {
    await pollForCondition(
        async () => {
            const data = (await apiGet(token, `/lineups/${poll.lineupId}/schedule/${poll.pollId}`)) as
                { match?: unknown } | null;
            return data?.match ? data : null;
        },
        { timeoutMs: 15_000, description: `poll ${poll.pollId} readable` },
    );
}

/** A context with no session at all — no cookies, no token. */
export async function openAnonContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    return { context, page: await context.newPage() };
}

/**
 * A second context signed in as the non-admin smoke member fixture
 * (`/admin/test/seed-fixture-user`, onboarded, role member) by putting its JWT
 * in `localStorage.raid_ledger_token` — the scheduling-poll-live-updates
 * pattern. No password is ever typed. Device options inherit the project's.
 */
export async function openMemberContext(
    browser: Browser,
): Promise<{ context: BrowserContext; page: Page; jwt: string; userId: number }> {
    const invitee = await getInviteeFixture();
    const context = await browser.newContext({ storageState: STORAGE_STATE_PATH });
    await context.addInitScript((t) => {
        localStorage.setItem('raid_ledger_token', t);
    }, invitee.jwt);
    return { context, page: await context.newPage(), jwt: invitee.jwt, userId: invitee.userId };
}
