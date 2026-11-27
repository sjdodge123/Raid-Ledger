/**
 * ROK-2370: the "last used" sign-in marker (operator ruling 2026-11-25
 * ~17:55Z, Cloudflare-style). After every successful sign-in the browser
 * remembers which method worked plus the member's display name and avatar
 * URL, so the next login page can offer that method first.
 *
 * It is NOT a credential: no token, no user id — only what the login page
 * shows. Sign-out keeps it (`clearAuthMethod` never touches this key); only
 * the card's "Not you?" clears it. Storage = localStorage via safe-storage
 * (APPLY — veto on PR).
 */
import { resolveAvatar, toAvatarUser } from './avatar';
import { safeGetItem, safeRemoveItem, safeSetItem } from './safe-storage';

export const LAST_SIGNIN_KEY = 'rl_last_signin';

/** Every sign-in method the marker can name (ROK-2371 added `'google'`). */
export const LAST_SIGNIN_METHODS = ['discord', 'discord-app-code', 'password', 'google'] as const;
export type LastSigninMethod = (typeof LAST_SIGNIN_METHODS)[number];

/** The stored marker. */
export interface LastSignin {
    method: LastSigninMethod;
    name: string;
    avatarUrl: string | null;
    at: number;
}

/** What a sign-in hands us: the signed-in user's public profile fields. */
export type LastSigninUser = Parameters<typeof toAvatarUser>[0] & { username: string; displayName: string | null };

function isMethod(value: unknown): value is LastSigninMethod {
    return typeof value === 'string' && (LAST_SIGNIN_METHODS as readonly string[]).includes(value);
}

function parseMarker(raw: string): LastSignin | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (!isMethod(v.method) || typeof v.name !== 'string' || v.name === '') return null;
    if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
    const avatarUrl = typeof v.avatarUrl === 'string' ? v.avatarUrl : null;
    return { method: v.method, name: v.name, avatarUrl, at: v.at };
}

function avatarFor(user: LastSigninUser): string | null {
    try {
        return resolveAvatar(toAvatarUser(user)).url;
    } catch {
        return null;
    }
}

/** Remember the method that just signed this member in (never throws). */
export function recordLastSignin(method: LastSigninMethod, user: LastSigninUser, now: number = Date.now()): void {
    const marker: LastSignin = {
        method, name: user.displayName || user.username, avatarUrl: avatarFor(user), at: now,
    };
    safeSetItem(LAST_SIGNIN_KEY, JSON.stringify(marker));
}

/** The stored marker, or null. A value that fails validation is dropped. */
export function readLastSignin(): LastSignin | null {
    const raw = safeGetItem(LAST_SIGNIN_KEY);
    if (raw === null) return null;
    const marker = parseMarker(raw);
    if (!marker) safeRemoveItem(LAST_SIGNIN_KEY);
    return marker;
}

/** Forget the marker ("Not you?"). */
export function clearLastSignin(): void {
    safeRemoveItem(LAST_SIGNIN_KEY);
}
