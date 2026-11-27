/**
 * ROK-2371: shared Google sign-in setting guard for smoke specs. The toggle is
 * GLOBAL and the desktop + mobile projects share one DB, so the enable -> assert
 * -> restore window is held under a cross-worker lock directory; otherwise one
 * project's restore would switch sign-in off under the other's assertions.
 * Only what the helper changed is restored (placeholder client fields it added,
 * and the prior toggle value).
 */
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from './base';
import { apiGet, apiPut, getAdminToken, pollForCondition } from './api-helpers';

export const SETTINGS = '/admin/settings/calendar-sync';
const LOCK_DIR = join(tmpdir(), 'rl-smoke-google-signin.lock');
const LOCK_STALE_MS = 120_000;

export interface GoogleSettings {
    googleSigninEnabled?: boolean;
    google: { clientId: string | null; hasSecret: boolean };
    redirectUris: { googleSignin?: string[] };
}

function tryLock(): boolean {
    try {
        mkdirSync(LOCK_DIR);
        return true;
    } catch {
        // A crashed run's lock: older than any test could hold it.
        try { if (Date.now() - statSync(LOCK_DIR).mtimeMs > LOCK_STALE_MS) rmSync(LOCK_DIR, { recursive: true }); } catch { /* raced */ }
        return false;
    }
}

/** Enable Google sign-in (placeholder client only where none is stored); returns the restore body. */
async function enableGoogleSignin(token: string): Promise<Record<string, unknown>> {
    const before = (await apiGet(token, SETTINGS)) as GoogleSettings;
    const google: Record<string, string> = {};
    if (!before.google.clientId) google.clientId = 'smoke-placeholder.apps.googleusercontent.com';
    if (!before.google.hasSecret) google.clientSecret = 'smoke-placeholder-secret';
    const res = await apiPut(token, SETTINGS, { googleSigninEnabled: true, ...(Object.keys(google).length ? { google } : {}) });
    expect(res, 'PUT enabling Google sign-in').toMatchObject({ googleSigninEnabled: true });
    await pollForCondition(async () => {
        const status = (await apiGet(token, '/system/status')) as { authProviders?: { key: string }[] } | null;
        return status?.authProviders?.some((p) => p.key === 'google') ?? false;
    }, { description: '/system/status lists the google login method', timeoutMs: 20_000 });
    const restoreGoogle: Record<string, string> = {};
    if (google.clientId) restoreGoogle.clientId = '';
    if (google.clientSecret) restoreGoogle.clientSecret = '';
    return { googleSigninEnabled: before.googleSigninEnabled ?? false, ...(Object.keys(restoreGoogle).length ? { google: restoreGoogle } : {}) };
}

/** Run `run` with Google sign-in enabled, serialised across projects; restores in `finally`. */
export async function withGoogleSignin(run: (settings: GoogleSettings, token: string) => Promise<void>): Promise<void> {
    await expect.poll(tryLock, { message: 'acquire the Google sign-in smoke lock', timeout: 75_000 }).toBe(true);
    const token = await getAdminToken();
    let restore: Record<string, unknown> | null = null;
    try {
        restore = await enableGoogleSignin(token);
        await run((await apiGet(token, SETTINGS)) as GoogleSettings, token);
    } finally {
        if (restore) await apiPut(token, SETTINGS, restore);
        rmSync(LOCK_DIR, { recursive: true, force: true });
    }
}
