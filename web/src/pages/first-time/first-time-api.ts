/**
 * ROK-2371 D1(a): the `/auth/first-time` choice screen's API calls. The
 * pending identity lives behind an httpOnly browser-bound cookie, so every
 * call sends credentials; nothing here carries a subject or an email.
 */
import { PendingIdentityViewSchema, type PendingIdentityViewDto } from '@raid-ledger/contract';
import { API_BASE_URL } from '../../lib/config';
import { nativeFetch } from '../../lib/api/native-fetch';
import { readLastSignin } from '../../lib/last-signin';

export type FirstTimeProvider = PendingIdentityViewDto['provider'];

/** The view, `'expired'` (404: no live pending identity), or `'error'`. */
export type PendingIdentityResult = PendingIdentityViewDto | 'expired' | 'error';

export async function fetchPendingIdentity(): Promise<PendingIdentityResult> {
    try {
        const res = await nativeFetch(`${API_BASE_URL}/auth/first-time`, { credentials: 'include' });
        if (res.status === 404) return 'expired';
        if (!res.ok) return 'error';
        const parsed = PendingIdentityViewSchema.safeParse(await res.json());
        return parsed.success ? parsed.data : 'error';
    } catch {
        return 'error';
    }
}

/** `{ redirect }` on success, else `'expired'` (404) or `'error'`. */
export type CreateResult = { redirect: string } | 'expired' | 'error';

export async function createFirstTimeAccount(): Promise<CreateResult> {
    try {
        const res = await nativeFetch(`${API_BASE_URL}/auth/first-time/create`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        if (res.status === 404) return 'expired';
        if (!res.ok) return 'error';
        const body: unknown = await res.json();
        const redirect = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).redirect : undefined;
        return typeof redirect === 'string' ? { redirect } : 'error';
    } catch {
        return 'error';
    }
}

/** The other provider's sign-in, started with the pending-link intent. */
export function pendingLinkUrl(other: FirstTimeProvider): string {
    return other === 'google'
        ? `${API_BASE_URL}/auth/google?intent=pending-link`
        : `${API_BASE_URL}/auth/discord/pending-link`;
}

/** True when this browser last signed in with `other` (the Discord-app code counts as Discord). */
export function lastUsedNames(other: FirstTimeProvider): boolean {
    const method = readLastSignin()?.method;
    if (method === other) return true;
    return other === 'discord' && method === 'discord-app-code';
}
