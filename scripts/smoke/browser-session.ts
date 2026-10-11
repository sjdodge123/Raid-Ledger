/**
 * Browser sessions for smoke specs (ROK-1754 §3.7).
 *
 * The web app no longer keeps an access token in localStorage: it holds it in
 * memory and mints it at boot from the httpOnly `rl_rt` refresh cookie. So a
 * spec signs a browser context in by giving that context its OWN refresh
 * family — the DEMO_MODE `POST /admin/test/browser-session` endpoint sets the
 * cookie in the context's jar — plus the `raid_ledger_auth_method` marker that
 * tells the boot path a session exists.
 *
 * Never share one `rl_rt` cookie between contexts (e.g. by saving it in
 * storageState): the first boot rotates it and a replay is reuse → family
 * revoke + blockUser(admin), which poisons every worker's admin token.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { getAdminToken } from './api-helpers';
import { resolveApiUrl } from './target';

/** Mirrors `web/src/lib/api/auth-storage-keys.ts` AUTH_METHOD_KEY. */
export const AUTH_METHOD_KEY = 'raid_ledger_auth_method';

/** A compact JWS (header.payload.signature, base64url) anywhere in a string. */
export const JWT_PATTERN = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/;

/**
 * The numeric `sub` claim of a JWT (no signature check — test fixtures only).
 *
 * @param token - A JWT minted by this API.
 * @returns The user id it was issued for.
 */
export function jwtSub(token: string): number {
    const payload = token.split('.')[1];
    if (!payload) throw new Error('[browser-session] not a JWT: no payload segment');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        sub?: unknown;
    };
    const sub = Number(claims.sub);
    if (!Number.isInteger(sub) || sub <= 0) {
        throw new Error(`[browser-session] JWT sub is not a user id: ${String(claims.sub)}`);
    }
    return sub;
}

/**
 * Sign a browser context in as `userId`: a fresh refresh family whose cookie
 * lands in this context's jar, plus the auth-method marker on every document.
 * Pages loaded AFTER this call boot as that user; an already-open page keeps
 * its in-memory token until its next full navigation.
 *
 * @param context - The browser context to sign in.
 * @param userId - The user the session belongs to.
 */
export async function signInContextAs(context: BrowserContext, userId: number): Promise<void> {
    const adminToken = await getAdminToken();
    const res = await context.request.post(`${resolveApiUrl()}/admin/test/browser-session`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { userId },
    });
    if (res.status() !== 204) {
        throw new Error(
            `[browser-session] POST /admin/test/browser-session {userId:${userId}} → ` +
                `${res.status()}: ${await res.text()} (needs DEMO_MODE and an admin token)`,
        );
    }
    await context.addInitScript((key) => {
        window.localStorage.setItem(key, 'local');
    }, AUTH_METHOD_KEY);
}

/** Sign a context in as the user a fixture JWT was issued for. */
export async function signInContextWithJwt(context: BrowserContext, jwt: string): Promise<void> {
    await signInContextAs(context, jwtSub(jwt));
}

/** Sign a context in as the smoke admin (the global-setup login's user). */
export async function signInAsAdmin(context: BrowserContext): Promise<void> {
    await signInContextAs(context, jwtSub(await getAdminToken()));
}

/**
 * Every `localStorage` / `sessionStorage` entry of the page's origin whose
 * value contains a JWT, as `local:<key>` / `session:<key>`. Empty = clean.
 */
export async function storageJwtEntries(page: Page): Promise<string[]> {
    return page.evaluate((source) => {
        const re = new RegExp(source);
        const hits: string[] = [];
        const scan = (label: string, store: Storage) => {
            for (let i = 0; i < store.length; i += 1) {
                const key = store.key(i);
                if (key !== null && re.test(store.getItem(key) ?? '')) hits.push(`${label}:${key}`);
            }
        };
        scan('local', window.localStorage);
        scan('session', window.sessionStorage);
        return hits;
    }, JWT_PATTERN.source);
}
